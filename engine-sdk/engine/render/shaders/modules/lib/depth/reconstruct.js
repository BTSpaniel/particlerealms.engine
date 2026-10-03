// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Depth Reconstruction - World Position from Depth
 * 
 * Reconstruct world-space position from depth buffer and screen coordinates.
 */

import { depthLinearizeWGSL } from './linearize.js';

export const depthReconstructWGSL = /* wgsl */`
${depthLinearizeWGSL}

// ============================================================================
// POSITION RECONSTRUCTION - Rebuild world position from depth
// ============================================================================

// Reconstruct view-space position from depth
fn reconstructViewPos(uv: vec2<f32>, depth: f32, invProj: mat4x4<f32>) -> vec3<f32> {
  let ndc = vec3<f32>(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, depth);
  let clipPos = vec4<f32>(ndc, 1.0);
  var viewPos = invProj * clipPos;
  viewPos = viewPos / viewPos.w;
  return viewPos.xyz;
}

// Reconstruct world-space position from depth
fn reconstructWorldPos(uv: vec2<f32>, depth: f32, invViewProj: mat4x4<f32>) -> vec3<f32> {
  let ndc = vec3<f32>(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, depth);
  let clipPos = vec4<f32>(ndc, 1.0);
  var worldPos = invViewProj * clipPos;
  worldPos = worldPos / worldPos.w;
  return worldPos.xyz;
}

// Fast view-space Z from depth (no matrix multiplication)
fn viewSpaceZ(depth: f32, nearPlane: f32, farPlane: f32) -> f32 {
  return linearizeDepthWebGPU(depth, nearPlane, farPlane);
}

// Reconstruct view-space position from linear depth and camera vectors
fn reconstructViewPosFromRay(uv: vec2<f32>, linearDepth: f32, cameraFwd: vec3<f32>, cameraRight: vec3<f32>, cameraUp: vec3<f32>, tanFovY: f32, aspect: f32) -> vec3<f32> {
  let x = (uv.x * 2.0 - 1.0) * aspect * tanFovY;
  let y = (uv.y * 2.0 - 1.0) * tanFovY;
  let viewDir = normalize(cameraFwd + cameraRight * x + cameraUp * y);
  return viewDir * linearDepth;
}
`;
