// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Volume Raymarch Shader - Density Field Visualization
// Renders 3D density grids using absorption/emission raymarching
//
// Modes:
// 0 - ABSORPTION: Beer-Lambert absorption only
// 1 - EMISSION: Additive emission only
// 2 - ABSORPTION_EMISSION: Combined (default)
// 3 - ISOSURFACE: Find surface, shade with estimated normal
// 4 - DEBUG_STEPS: Visualize ray step count

// ============================================================================
// STRUCTURES
// ============================================================================

struct Uniforms {
    cameraPos: vec3f,
    pad0: f32,
    boundsMin: vec3f,
    pad1: f32,
    boundsMax: vec3f,
    pad2: f32,

    // Raymarch parameters
    maxSteps: f32,
    stepSize: f32,
    maxDistance: f32,
    absorption: f32,

    scattering: f32,
    emissionStrength: f32,
    densityThreshold: f32,
    renderMode: f32,

    gridSize: f32,
    width: f32,
    height: f32,
    time: f32,

    // View matrix (inverse view-projection for ray generation)
    invViewProj: mat4x4f,
}

struct ColorRampEntry {
    color: vec3f,
    density: f32,
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var densityTex: texture_3d<f32>;
@group(0) @binding(2) var densitySampler: sampler;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<storage, read> colorRamp: array<vec4f, 16>;

// Optional: light direction for shading
@group(0) @binding(5) var<uniform> lightDir: vec3f;

// ============================================================================
// RAY-BOX INTERSECTION
// ============================================================================

fn intersectBox(ro: vec3f, rd: vec3f, boxMin: vec3f, boxMax: vec3f) -> vec2f {
    let invRd = 1.0 / rd;
    let t0 = (boxMin - ro) * invRd;
    let t1 = (boxMax - ro) * invRd;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    let tNear = max(max(tmin.x, tmin.y), tmin.z);
    let tFar = min(min(tmax.x, tmax.y), tmax.z);
    return vec2f(tNear, tFar);
}

// ============================================================================
// DENSITY SAMPLING
// ============================================================================

fn sampleDensity(p: vec3f) -> f32 {
    // Normalize position to [0, 1] within bounds
    let size = uniforms.boundsMax - uniforms.boundsMin;
    let uvw = (p - uniforms.boundsMin) / size;

    // Clamp to bounds
    if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) {
        return 0.0;
    }

    return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

// Sample with trilinear interpolation (manual, for buffer-based grids)
fn sampleDensityBuffer(p: vec3f, gridSize: u32) -> f32 {
    let size = uniforms.boundsMax - uniforms.boundsMin;
    let uvw = (p - uniforms.boundsMin) / size;

    if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) {
        return 0.0;
    }

    let gridPos = uvw * f32(gridSize - 1u);
    let basePos = vec3u(floor(gridPos));
    let frac = fract(gridPos);

    // Would need buffer binding for grid data
    // For now, use texture
    return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

// ============================================================================
// COLOR MAPPING
// ============================================================================

fn getColorFromRamp(density: f32) -> vec4f {
    // Find segment in ramp
    for (var i = 0u; i < 15u; i++) {
        let d0 = colorRamp[i].w;
        let d1 = colorRamp[i + 1u].w;

        if (density >= d0 && density <= d1 && d1 > d0) {
            let t = (density - d0) / (d1 - d0);
            return vec4f(
                mix(colorRamp[i].rgb, colorRamp[i + 1u].rgb, t),
                1.0
            );
        }
    }

    // Default: white at high density
    return vec4f(1.0, 1.0, 1.0, density);
}

// Simple blue-white color based on density
fn getDefaultColor(density: f32) -> vec3f {
    let baseColor = vec3f(0.2, 0.5, 0.9);
    let highlightColor = vec3f(1.0, 1.0, 1.0);
    return mix(baseColor, highlightColor, saturate(density * 2.0));
}

// ============================================================================
// GRADIENT ESTIMATION (FOR NORMALS)
// ============================================================================

fn estimateGradient(p: vec3f) -> vec3f {
    let eps = uniforms.stepSize * 0.5;

    let dx = sampleDensity(p + vec3f(eps, 0.0, 0.0)) - sampleDensity(p - vec3f(eps, 0.0, 0.0));
    let dy = sampleDensity(p + vec3f(0.0, eps, 0.0)) - sampleDensity(p - vec3f(0.0, eps, 0.0));
    let dz = sampleDensity(p + vec3f(0.0, 0.0, eps)) - sampleDensity(p - vec3f(0.0, 0.0, eps));

    let grad = vec3f(dx, dy, dz);
    let len = length(grad);

    if (len < 0.0001) {
        return vec3f(0.0, 1.0, 0.0);
    }

    return grad / len;
}

// ============================================================================
// SHADOW RAY
// ============================================================================

fn shadowRay(origin: vec3f, lightDirection: vec3f) -> f32 {
    var shadowDensity = 0.0;
    var t = uniforms.stepSize;
    let shadowSteps = 16u;
    let maxShadowDist = 10.0;

    for (var i = 0u; i < shadowSteps; i++) {
        let p = origin + lightDirection * t;
        let density = sampleDensity(p);
        shadowDensity += density * uniforms.stepSize * uniforms.absorption * 2.0;

        if (shadowDensity > 3.0) {
            break; // Fully shadowed
        }

        t += uniforms.stepSize * 2.0;
        if (t > maxShadowDist) {
            break;
        }
    }

    return exp(-shadowDensity);
}

// ============================================================================
// MAIN RAYMARCH FUNCTIONS
// ============================================================================

// Standard absorption + emission raymarch
fn raymarchAbsorptionEmission(ro: vec3f, rd: vec3f) -> vec4f {
    let tBox = intersectBox(ro, rd, uniforms.boundsMin, uniforms.boundsMax);

    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return vec4f(0.0);
    }

    var t = max(tBox.x, 0.0);
    let tMax = min(tBox.y, uniforms.maxDistance);

    var accColor = vec3f(0.0);
    var transmittance = 1.0;
    var steps = 0u;

    let maxSteps = u32(uniforms.maxSteps);
    let stepSize = uniforms.stepSize;
    let threshold = uniforms.densityThreshold;

    // Light direction for self-shadowing
    let lightDir = normalize(vec3f(1.0, 1.0, 0.5));

    loop {
        if (t > tMax || transmittance < 0.01 || steps >= maxSteps) {
            break;
        }

        let p = ro + t * rd;
        let density = sampleDensity(p);

        if (density > threshold) {
            // Absorption (Beer-Lambert)
            let absorption = uniforms.absorption * density * stepSize;
            let stepTransmittance = exp(-absorption);

            // Get color from density
            let sampleColor = getDefaultColor(density);

            // Optional: self-shadowing
            let shadow = shadowRay(p, lightDir);

            // Emission with shadow
            let emission = sampleColor * uniforms.emissionStrength * density * stepSize * (0.5 + 0.5 * shadow);

            // Accumulate
            accColor += emission * transmittance;
            transmittance *= stepTransmittance;
        }

        t += stepSize;
        steps++;
    }

    return vec4f(accColor, 1.0 - transmittance);
}

// Isosurface raymarch - finds surface and shades it
fn raymarchIsosurface(ro: vec3f, rd: vec3f, isoValue: f32) -> vec4f {
    let tBox = intersectBox(ro, rd, uniforms.boundsMin, uniforms.boundsMax);

    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return vec4f(0.0);
    }

    var t = max(tBox.x, 0.0);
    let tMax = min(tBox.y, uniforms.maxDistance);
    let stepSize = uniforms.stepSize;

    var prevDensity = sampleDensity(ro + t * rd);
    t += stepSize;

    let maxSteps = u32(uniforms.maxSteps);
    var steps = 0u;

    loop {
        if (t > tMax || steps >= maxSteps) {
            break;
        }

        let p = ro + t * rd;
        let density = sampleDensity(p);

        // Check for surface crossing
        if ((prevDensity < isoValue && density >= isoValue) ||
            (prevDensity >= isoValue && density < isoValue)) {

            // Binary search refinement
            var tLo = t - stepSize;
            var tHi = t;

            for (var i = 0u; i < 5u; i++) {
                let tMid = (tLo + tHi) * 0.5;
                let midDensity = sampleDensity(ro + tMid * rd);

                if ((prevDensity < isoValue) == (midDensity < isoValue)) {
                    tLo = tMid;
                } else {
                    tHi = tMid;
                }
            }

            let hitPoint = ro + tHi * rd;
            let normal = estimateGradient(hitPoint);

            // Phong shading
            let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
            let viewDir = normalize(ro - hitPoint);
            let halfDir = normalize(lightDir + viewDir);

            let ambient = 0.15;
            let diffuse = max(dot(normal, lightDir), 0.0) * 0.7;
            let specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.3;

            // Fresnel rim
            let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * 0.2;

            let baseColor = vec3f(0.3, 0.5, 0.9);
            let color = baseColor * (ambient + diffuse) + vec3f(1.0) * (specular + fresnel);

            return vec4f(color, 1.0);
        }

        prevDensity = density;
        t += stepSize;
        steps++;
    }

    return vec4f(0.0);
}

// Debug mode: visualize ray steps
fn raymarchDebugSteps(ro: vec3f, rd: vec3f) -> vec4f {
    let tBox = intersectBox(ro, rd, uniforms.boundsMin, uniforms.boundsMax);

    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return vec4f(0.0, 0.0, 0.1, 0.5);
    }

    var t = max(tBox.x, 0.0);
    let tMax = min(tBox.y, uniforms.maxDistance);
    var steps = 0u;
    var hitDensity = 0.0;

    let maxSteps = u32(uniforms.maxSteps);

    loop {
        if (t > tMax || steps >= maxSteps) {
            break;
        }

        let p = ro + t * rd;
        let density = sampleDensity(p);
        hitDensity = max(hitDensity, density);

        t += uniforms.stepSize;
        steps++;
    }

    let stepRatio = f32(steps) / f32(maxSteps);

    // Color: blue (few steps) -> green -> yellow -> red (many steps)
    var color: vec3f;
    if (stepRatio < 0.33) {
        color = mix(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), stepRatio * 3.0);
    } else if (stepRatio < 0.66) {
        color = mix(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 1.0, 0.0), (stepRatio - 0.33) * 3.0);
    } else {
        color = mix(vec3f(1.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), (stepRatio - 0.66) * 3.0);
    }

    return vec4f(color * (0.5 + 0.5 * hitDensity), 1.0);
}

// ============================================================================
// RAY GENERATION
// ============================================================================

fn generateRay(pixelCoord: vec2u) -> vec3f {
    let uv = (vec2f(pixelCoord) + 0.5) / vec2f(uniforms.width, uniforms.height);
    let ndc = uv * 2.0 - 1.0;

    // Use inverse view-projection matrix
    let clipPos = vec4f(ndc.x, -ndc.y, 1.0, 1.0);
    var worldPos = uniforms.invViewProj * clipPos;
    worldPos /= worldPos.w;

    return normalize(worldPos.xyz - uniforms.cameraPos);
}

// Simple ray generation (assumes looking down -Z)
fn generateRaySimple(pixelCoord: vec2u, fov: f32) -> vec3f {
    let uv = (vec2f(pixelCoord) + 0.5) / vec2f(uniforms.width, uniforms.height);
    let ndc = uv * 2.0 - 1.0;

    let aspect = uniforms.width / uniforms.height;
    let tanHalfFov = tan(fov * 0.5);

    return normalize(vec3f(
        ndc.x * tanHalfFov * aspect,
        -ndc.y * tanHalfFov,
        -1.0
    ));
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let pixelCoord = gid.xy;

    if (pixelCoord.x >= u32(uniforms.width) || pixelCoord.y >= u32(uniforms.height)) {
        return;
    }

    let ro = uniforms.cameraPos;
    let rd = generateRaySimple(pixelCoord, 1.0); // ~60° FOV

    var color: vec4f;

    let mode = u32(uniforms.renderMode);
    switch (mode) {
        case 0u, 1u, 2u: {
            // Absorption/Emission modes
            color = raymarchAbsorptionEmission(ro, rd);
        }
        case 3u: {
            // Isosurface
            color = raymarchIsosurface(ro, rd, 0.5);
        }
        case 4u: {
            // Debug steps
            color = raymarchDebugSteps(ro, rd);
        }
        default: {
            color = raymarchAbsorptionEmission(ro, rd);
        }
    }

    textureStore(outputTex, pixelCoord, color);
}

// ============================================================================
// ALTERNATIVE: FRAGMENT SHADER VERSION (for fullscreen quad)
// ============================================================================

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    // Fullscreen triangle
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2f(x, 1.0 - y);

    return output;
}

@fragment
fn fs_raymarch(input: VertexOutput) -> @location(0) vec4f {
    let pixelCoord = vec2u(input.uv * vec2f(uniforms.width, uniforms.height));

    let ro = uniforms.cameraPos;
    let rd = generateRaySimple(pixelCoord, 1.0);

    return raymarchAbsorptionEmission(ro, rd);
}
