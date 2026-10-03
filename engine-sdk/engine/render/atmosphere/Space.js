// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Space.js - Space Environment Effects
 * 
 * Contains nebula, deep space stars, and cosmic effects.
 * Use this when in space (no atmosphere).
 */

// WGSL shader code for space rendering
export const SpaceWGSL = /* wgsl */ `
// --- NEBULA EFFECT (Star Nest) ---
fn nebula(direction: vec3<f32>, time: f32) -> vec3<f32> {
    let iterations = 12;
    let volsteps = 8;
    let formuparam = 0.53;
    let stepsize = 0.15;
    let tile = 0.85;
    let brightness = 0.002;
    let distfading = 0.73;
    let darkmatter = 0.3;
    
    var dir = normalize(direction);
    var origin = vec3<f32>(1.0, 0.5, 0.5);
    origin += vec3<f32>(time * 0.02, time * 0.01, time * -0.015);
    
    var s = 0.1;
    var fade = 1.0;
    var v = vec3<f32>(0.0);
    
    for (var r = 0; r < volsteps; r++) {
        var p = origin + s * dir * 0.5;
        p = abs(vec3<f32>(tile) - (p % vec3<f32>(tile * 2.0)));
        
        var pa = 0.0;
        var a = 0.0;
        for (var i = 0; i < iterations; i++) {
            let dp = dot(p, p);
            if (dp > 0.0001) {
                p = abs(p) / dp - formuparam;
            }
            a += abs(length(p) - pa);
            pa = length(p);
        }
        
        let dm = max(0.0, darkmatter - a * a * 0.001);
        a = a * a * a;
        
        if (r > 3) { fade *= 1.0 - dm; }
        
        v += fade;
        v += vec3<f32>(s, s * s, s * s * s * s) * a * brightness * fade;
        fade *= distfading;
        s += stepsize;
    }
    
    let sat = 0.85;
    v = mix(vec3<f32>(length(v)), v, sat);
    return v * 0.015;
}

// Deep space point stars
fn spaceStars(direction: vec3<f32>, time: f32, density: f32) -> f32 {
    let scale = density * 100.0;
    let cell = floor(direction * scale);
    var p3 = fract(cell * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    let rand = fract((p3.x + p3.y) * p3.z);
    
    if (rand > 0.93) {
        let twinkle = sin(time * 1.2 + rand * 100.0) * 0.15 + 0.85;
        let starBright = pow(rand, 5.0) * twinkle;
        let cellCenter = (cell + 0.5) / scale;
        let dist = length(direction - cellCenter);
        if (dist < 0.004) {
            return starBright * (1.0 - dist / 0.004);
        }
    }
    return 0.0;
}

// Render complete space sky
fn renderSpace(direction: vec3<f32>, time: f32, nebulaIntensity: f32, starDensity: f32) -> vec3<f32> {
    var color = vec3<f32>(0.0, 0.0, 0.01);
    
    // Nebula
    color += nebula(direction, time) * nebulaIntensity;
    
    // Stars with color variation
    let stars = spaceStars(direction, time, starDensity);
    let cell = floor(direction * 50.0);
    var p3 = fract(cell * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    let colorVar = fract((p3.x + p3.y) * p3.z);
    let starColor = mix(vec3<f32>(0.9, 0.95, 1.0), vec3<f32>(1.0, 0.85, 0.7), colorVar);
    color += starColor * stars;
    
    return color;
}
`;

export default SpaceWGSL;
