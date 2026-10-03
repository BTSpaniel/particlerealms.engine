// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * 3D Noise Functions for Volumetric Effects
 * Used for smoke turbulence, wispy distortion, and organic blending
 */

export const noise3dLibrary = /* wgsl */`
// 3D Value Noise
fn hash3(p: vec3<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.z) * 0.1031);
    p3 += dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise3d(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 0.0)), hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x),
            u.y
        ),
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x),
            u.y
        ),
        u.z
    );
}

// Fractal Brownian Motion (multi-octave noise)
fn fbm3d(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pp = p;
    
    for (var i = 0; i < octaves; i++) {
        value += amplitude * noise3d(pp * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    
    return value;
}

// Turbulence (absolute value of noise)
fn turbulence3d(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pp = p;
    
    for (var i = 0; i < octaves; i++) {
        value += amplitude * abs(noise3d(pp * frequency) * 2.0 - 1.0);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    
    return value;
}

// Domain warping for organic distortion
fn domainWarp3d(p: vec3<f32>, amount: f32) -> vec3<f32> {
    let q = vec3<f32>(
        fbm3d(p + vec3<f32>(0.0, 0.0, 0.0), 4),
        fbm3d(p + vec3<f32>(5.2, 1.3, 0.0), 4),
        fbm3d(p + vec3<f32>(0.0, 0.0, 8.3), 4)
    );
    
    return p + amount * q;
}

// Curl noise (divergence-free for smoke flow)
fn curlNoise3d(p: vec3<f32>) -> vec3<f32> {
    let eps = 0.01;
    
    let dx = vec3<f32>(eps, 0.0, 0.0);
    let dy = vec3<f32>(0.0, eps, 0.0);
    let dz = vec3<f32>(0.0, 0.0, eps);
    
    let px = fbm3d(p + dx, 3);
    let py = fbm3d(p + dy, 3);
    let pz = fbm3d(p + dz, 3);
    let nx = fbm3d(p - dx, 3);
    let ny = fbm3d(p - dy, 3);
    let nz = fbm3d(p - dz, 3);
    
    return vec3<f32>(
        (py - ny) - (pz - nz),
        (pz - nz) - (px - nx),
        (px - nx) - (py - ny)
    ) / (2.0 * eps);
}
`;
