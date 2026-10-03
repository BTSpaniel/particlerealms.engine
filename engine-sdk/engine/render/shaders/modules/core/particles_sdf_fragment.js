// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Volumetric SDF Particle Fragment Shader
 * 
 * Raymarches signed distance fields for realistic 3D particle shapes.
 */

import { ShaderComposer } from '../../ShaderComposer.js';

const fragmentWGSL = /* wgsl */`
// Shape types
const SHAPE_SPHERE: u32 = 0u;
const SHAPE_ELLIPSOID: u32 = 1u;
const SHAPE_CAPSULE: u32 = 2u;
const SHAPE_ROUNDED_BOX: u32 = 3u;
const SHAPE_TORUS: u32 = 4u;

struct RaymarchResult {
    hit: bool,
    dist: f32,
    steps: i32,
    density: f32,
};

// Map the scene for a specific particle shape
fn mapScene(p: vec3<f32>, shapeType: u32, shapeScale: vec3<f32>) -> f32 {
    switch (shapeType) {
        case SHAPE_SPHERE: {
            return sdSphere(p, shapeScale.x);
        }
        case SHAPE_ELLIPSOID: {
            return sdEllipsoid(p, shapeScale);
        }
        case SHAPE_CAPSULE: {
            let a = vec3<f32>(0.0, -shapeScale.y * 0.5, 0.0);
            let b = vec3<f32>(0.0, shapeScale.y * 0.5, 0.0);
            return sdCapsule(p, a, b, shapeScale.x);
        }
        case SHAPE_ROUNDED_BOX: {
            return sdRoundBox(p, shapeScale, shapeScale.x * 0.2);
        }
        case SHAPE_TORUS: {
            return sdTorus(p, vec2<f32>(shapeScale.x, shapeScale.y));
        }
        default: {
            return sdSphere(p, shapeScale.x);
        }
    }
}

// Raymarch the SDF volume
fn raymarch(ro: vec3<f32>, rd: vec3<f32>, shapeType: u32, shapeScale: vec3<f32>, maxDist: f32) -> RaymarchResult {
    var result: RaymarchResult;
    result.hit = false;
    result.dist = 0.0;
    result.steps = 0;
    result.density = 0.0;
    
    var t = 0.0;
    let maxSteps = 32;
    let minDist = 0.001;
    
    for (var i = 0; i < maxSteps; i++) {
        result.steps = i;
        let p = ro + rd * t;
        let d = mapScene(p, shapeType, shapeScale);
        
        if (d < minDist) {
            result.hit = true;
            result.dist = t;
            // Soft density based on how deep we are in the volume
            result.density = 1.0 - smoothstep(0.0, shapeScale.x * 0.5, abs(d));
            break;
        }
        
        if (t > maxDist) {
            break;
        }
        
        t += max(d * 0.5, 0.01); // Conservative step with minimum
    }
    
    return result;
}

// Calculate normal from SDF
fn calcNormal(p: vec3<f32>, shapeType: u32, shapeScale: vec3<f32>) -> vec3<f32> {
    let eps = 0.001;
    let h = vec2<f32>(eps, 0.0);
    return normalize(vec3<f32>(
        mapScene(p + h.xyy, shapeType, shapeScale) - mapScene(p - h.xyy, shapeType, shapeScale),
        mapScene(p + h.yxy, shapeType, shapeScale) - mapScene(p - h.yxy, shapeType, shapeScale),
        mapScene(p + h.yyx, shapeType, shapeScale) - mapScene(p - h.yyx, shapeType, shapeScale)
    ));
}

// Environment-aware volumetric lighting (reads sun + ambient from FrameUniforms)
fn volumetricLighting(
    p: vec3<f32>,
    normal: vec3<f32>,
    viewDir: vec3<f32>,
    lightDir: vec3<f32>,
    color: vec3<f32>
) -> vec3<f32> {
    // Diffuse — sun color × intensity
    let ndl = max(dot(normal, lightDir), 0.0);
    let diffuse = color * uFrame.sunColor * uFrame.sunIntensity * ndl;
    
    // Ambient — from environment
    let ambient = color * uFrame.ambientColor * uFrame.ambientIntensity;
    
    // Rim lighting tinted by sun
    let rim = pow(1.0 - max(dot(normal, -viewDir), 0.0), 3.0);
    let rimLight = uFrame.sunColor * rim * 0.5;
    
    // Subsurface scattering tinted by sun
    let backLight = max(dot(-normal, lightDir), 0.0);
    let subsurface = color * uFrame.sunColor * backLight * 0.3;
    
    return diffuse + ambient + rimLight + subsurface;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    // Billboard space to view space
    let rayOrigin = vec3<f32>(input.localPos.x, input.localPos.y, 1.0);
    let rayDir = normalize(vec3<f32>(0.0, 0.0, -1.0));
    
    // Extract shape type from particle meta
    // For now, default to sphere - will add shape parameter later
    let shapeType = SHAPE_SPHERE;
    let shapeScale = vec3<f32>(0.5, 0.5, 0.5);
    
    // Raymarch the volume
    let maxDist = 2.0;
    let result = raymarch(rayOrigin, rayDir, shapeType, shapeScale, maxDist);
    
    if (!result.hit) {
        discard;
    }
    
    // Calculate hit position and normal
    let hitPos = rayOrigin + rayDir * result.dist;
    let normal = calcNormal(hitPos, shapeType, shapeScale);
    
    // Lighting — sun direction from environment
    let lightDir = normalize(-uFrame.sunDir);
    let viewDir = -rayDir;
    let lit = volumetricLighting(hitPos, normal, viewDir, lightDir, input.color);
    
    // Soft edges with density
    let edgeFalloff = result.density * input.particleDensity;
    let alpha = edgeFalloff * smoothstep(0.0, 0.1, result.density);
    
    return vec4<f32>(lit, alpha);
}
`;

export const particlesSdfFragmentShader = ShaderComposer.compose({
    libs: ['sdf/shapes'],
    vertex: '', // Will use existing billboard vertex shader
    fragment: fragmentWGSL
});
