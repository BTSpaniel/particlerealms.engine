// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID WATER DEPTH PASS - Render particles as sphere impostors to depth texture
// =============================================================================
// This is Pass 1 of the screen-space water rendering pipeline.
// 
// Each water/metaball particle is rendered as a sphere impostor (billboard that
// writes correct sphere depth). The resulting depth texture is then blurred to
// create smooth, merged surfaces.
//
// Render mode filtering:
//   - renderMode 1 (water) → liquid surfaces with refraction
//   - renderMode 2 (metaball) → emissive orbs with glow

export const fluidWaterDepthWGSL = /* wgsl */`
// =============================================================================
// FLUID WATER DEPTH - Sphere Impostor Pass
// =============================================================================

struct FrameData {
  viewProj    : mat4x4<f32>,
  view        : mat4x4<f32>,
  proj        : mat4x4<f32>,
  cameraPos   : vec3<f32>,
  sphereScale : f32,          // Multiplier for particle size → sphere radius
  screenSize  : vec2<f32>,
  nearPlane   : f32,
  farPlane    : f32,
};

struct ParticleData {
  position : vec3<f32>,
  age      : f32,
  velocity : vec3<f32>,
  lifetime : f32,
  color    : vec3<f32>,
  packed   : f32,  // size * 100 + renderMode * 10 + shape
};

@group(0) @binding(0) var<uniform> frame : FrameData;
@group(1) @binding(0) var<storage, read> positions : array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities : array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta : array<vec4<f32>>;

// Decode functions
fn decodeSize(packed : f32) -> f32 {
  return floor(packed / 100.0);
}

fn decodeRenderMode(packed : f32) -> u32 {
  return u32(floor(packed / 10.0) % 10.0);
}

// Vertex output
struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) viewPos : vec3<f32>,        // View-space center of sphere
  @location(1) sphereRadius : f32,         // World-space radius
  @location(2) localUV : vec2<f32>,        // UV on billboard quad (-1 to 1)
  @location(3) particleColor : vec3<f32>,  // For metaball coloring
  @location(4) renderMode : f32,           // 1=water, 2=metaball
};

// Generate billboard quad vertices (6 vertices per particle, 2 triangles)
@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VSOut {
  var out : VSOut;
  
  // Read particle data
  let pos4 = positions[instanceIndex];
  let vel4 = velocities[instanceIndex];
  let meta4 = particleMeta[instanceIndex];
  
  let worldPos = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let packed = meta4.a;
  
  // Decode render mode based on states of matter:
  // 0=gas, 1=liquid, 2=solid, 3=plasma
  let mode = decodeRenderMode(packed);
  
  // Skip dead particles or gas-only particles (gas uses volumetric raymarching)
  // Only render liquid (1) and plasma (3) via screen-space pass
  if (age >= lifetime || (mode != 1u && mode != 3u)) {
    // Degenerate triangle (will be clipped)
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.viewPos = vec3<f32>(0.0);
    out.sphereRadius = 0.0;
    out.localUV = vec2<f32>(0.0);
    out.particleColor = vec3<f32>(0.0);
    out.renderMode = 0.0;
    return out;
  }
  
  // Get sphere radius from particle size
  let size = decodeSize(packed);
  let radius = max(size * frame.sphereScale, 0.1);
  
  // Fade radius with age
  let lifeRatio = 1.0 - clamp(age / lifetime, 0.0, 1.0);
  let effectiveRadius = radius * lifeRatio;
  
  // Billboard quad corners (2 triangles = 6 vertices)
  // Triangle 1: 0,1,2  Triangle 2: 2,1,3
  var cornerOffsets = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),  // 0: bottom-left
    vec2<f32>( 1.0, -1.0),  // 1: bottom-right
    vec2<f32>(-1.0,  1.0),  // 2: top-left
    vec2<f32>(-1.0,  1.0),  // 2: top-left
    vec2<f32>( 1.0, -1.0),  // 1: bottom-right
    vec2<f32>( 1.0,  1.0),  // 3: top-right
  );
  
  let localOffset = cornerOffsets[vertexIndex % 6u];
  
  // Transform particle center to view space
  let viewCenter = (frame.view * vec4<f32>(worldPos, 1.0)).xyz;
  
  // Offset in view space (billboard facing camera)
  let viewOffset = vec3<f32>(localOffset * effectiveRadius, 0.0);
  let viewPos = viewCenter + viewOffset;
  
  // Project to clip space
  out.position = frame.proj * vec4<f32>(viewPos, 1.0);
  out.viewPos = viewCenter;
  out.sphereRadius = effectiveRadius;
  out.localUV = localOffset;
  out.particleColor = meta4.rgb;
  out.renderMode = f32(mode);
  
  return out;
}

// Fragment shader - compute sphere depth
struct FSOut {
  @builtin(frag_depth) depth : f32,
  @location(0) viewDepth : vec4<f32>,  // Linear view-space depth for blur (rgba16float)
};

@fragment
fn fs_main(input : VSOut) -> FSOut {
  var out : FSOut;
  
  // Skip degenerate particles
  if (input.sphereRadius <= 0.0) {
    discard;
  }
  
  // Compute sphere intersection
  // Ray from camera through this pixel in view space
  let uvLen = length(input.localUV);
  
  // If outside unit circle, discard (not on sphere)
  if (uvLen > 1.0) {
    discard;
  }
  
  // Compute Z offset on sphere surface (front face)
  // Sphere equation: x² + y² + z² = r²
  // localUV is normalized to sphere radius, so:
  let zOffset = sqrt(1.0 - uvLen * uvLen) * input.sphereRadius;
  
  // View-space Z of sphere surface (camera looks down -Z)
  let surfaceViewZ = input.viewPos.z + zOffset;
  
  // Convert to normalized device depth
  // For standard perspective: depth = (far * near) / (far - near) / -viewZ + far / (far - near)
  // But we use projection matrix for accuracy
  let surfaceViewPos = vec3<f32>(
    input.viewPos.x + input.localUV.x * input.sphereRadius,
    input.viewPos.y + input.localUV.y * input.sphereRadius,
    surfaceViewZ
  );
  
  let clipPos = frame.proj * vec4<f32>(surfaceViewPos, 1.0);
  out.depth = clipPos.z / clipPos.w;
  
  // Store linear view depth for bilateral blur (depth in .r channel)
  out.viewDepth = vec4<f32>(-surfaceViewZ, 0.0, 0.0, 1.0);
  
  return out;
}
`;

export default fluidWaterDepthWGSL;
