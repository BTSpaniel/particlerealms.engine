// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Camera Utilities for Shaders
 * 
 * Common camera operations for ray generation and view transforms.
 * Used by: ray marching, ray tracing, post-processing
 * 
 * Functions:
 *   - getCameraMatrix(ro, ta, roll) - Look-at camera matrix
 *   - getRay(uv, ro, ta) - Generate ray from UV and camera
 *   - screenToWorld(uv, invViewProj) - Unproject screen to world
 */

export const cameraUtilsWGSL = /* wgsl */`
// ============================================================================
// CAMERA UTILITIES
// ============================================================================

// Build camera matrix from position and target (look-at)
// ro = ray origin (camera position)
// ta = target (look-at point)
// roll = camera roll in radians (usually 0)
fn getCameraMatrix(ro : vec3<f32>, ta : vec3<f32>, roll : f32) -> mat3x3<f32> {
  let cw = normalize(ta - ro);  // Forward
  let cp = vec3<f32>(sin(roll), cos(roll), 0.0);  // Up with roll
  let cu = normalize(cross(cw, cp));  // Right
  let cv = cross(cu, cw);  // True up
  return mat3x3<f32>(cu, cv, cw);
}

// Simplified look-at (no roll)
fn getCameraMatrixSimple(ro : vec3<f32>, ta : vec3<f32>) -> mat3x3<f32> {
  let cw = normalize(ta - ro);
  let cp = vec3<f32>(0.0, 1.0, 0.0);
  let cu = normalize(cross(cw, cp));
  let cv = cross(cu, cw);
  return mat3x3<f32>(cu, cv, cw);
}

// Generate ray direction from screen UV and camera
// uv should be centered (-0.5 to 0.5) and aspect corrected
// fov controls field of view (1.0 = ~53 degrees, 2.0 = ~90 degrees)
fn getRayDirection(uv : vec2<f32>, cam : mat3x3<f32>, fov : f32) -> vec3<f32> {
  return normalize(cam * vec3<f32>(uv, fov));
}

// Convert screen coordinates to centered, aspect-corrected UV
fn screenToUV(fragCoord : vec2<f32>, resolution : vec2<f32>) -> vec2<f32> {
  var uv = fragCoord / resolution - 0.5;
  uv.x = uv.x * (resolution.x / resolution.y);  // Aspect correction
  return uv;
}

// Full ray generation from screen coordinates
fn generateRay(
  fragCoord : vec2<f32>,
  resolution : vec2<f32>,
  cameraPos : vec3<f32>,
  cameraTarget : vec3<f32>,
  fov : f32
) -> vec3<f32> {
  let uv = screenToUV(fragCoord, resolution);
  let cam = getCameraMatrixSimple(cameraPos, cameraTarget);
  return getRayDirection(uv, cam, fov);
}

// ============================================================================
// PROJECTION UTILITIES
// ============================================================================

// Unproject screen point to world space
// clipPos = vec4(ndcX, ndcY, depth, 1.0)
fn unprojectPoint(clipPos : vec4<f32>, invViewProj : mat4x4<f32>) -> vec3<f32> {
  var worldPos = invViewProj * clipPos;
  return worldPos.xyz / worldPos.w;
}

// Get world ray from screen UV using inverse matrices
fn getWorldRay(
  uv : vec2<f32>,  // 0-1 screen coords
  cameraPos : vec3<f32>,
  invViewProj : mat4x4<f32>
) -> vec3<f32> {
  // Convert UV to NDC
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = uv.y * 2.0 - 1.0;
  
  // Unproject far plane point
  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);
  let worldFar = unprojectPoint(clipFar, invViewProj);
  
  // Ray direction
  return normalize(worldFar - cameraPos);
}

// Linearize depth buffer value
fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32 {
  return near * far / (far - depth * (far - near));
}

// Reconstruct world position from depth
fn reconstructWorldPos(
  uv : vec2<f32>,
  depth : f32,
  invViewProj : mat4x4<f32>
) -> vec3<f32> {
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = uv.y * 2.0 - 1.0;
  let clipPos = vec4<f32>(ndcX, ndcY, depth, 1.0);
  return unprojectPoint(clipPos, invViewProj);
}
`;
