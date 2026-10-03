// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Depth Buffer Utilities - Linearization
 * 
 * Functions for linearizing depth values from perspective projection.
 * WebGPU uses [0,1] depth range with perspective non-linearity.
 */

export const depthLinearizeWGSL = /* wgsl */`
// ============================================================================
// DEPTH LINEARIZATION - Convert perspective depth to linear view space
// ============================================================================

// Linearize perspective depth to view-space distance
// nearPlane, farPlane: camera frustum planes
// depth: raw depth buffer value [0,1]
fn linearizeDepth(depth: f32, nearPlane: f32, farPlane: f32) -> f32 {
  let z_n = 2.0 * depth - 1.0;  // Convert to NDC [-1,1]
  return 2.0 * nearPlane * farPlane / (farPlane + nearPlane - z_n * (farPlane - nearPlane));
}

// Linearize depth for WebGPU [0,1] clip space
fn linearizeDepthWebGPU(depth: f32, nearPlane: f32, farPlane: f32) -> f32 {
  return nearPlane * farPlane / (farPlane - depth * (farPlane - nearPlane));
}

// Normalize linear depth to [0,1] range
fn normalizeLinearDepth(linearDepth: f32, nearPlane: f32, farPlane: f32) -> f32 {
  return clamp((linearDepth - nearPlane) / (farPlane - nearPlane), 0.0, 1.0);
}

// Logarithmic depth for better precision across entire range
fn logDepth(depth: f32, farPlane: f32) -> f32 {
  let C = 1.0;
  return log(depth * C + 1.0) / log(farPlane * C + 1.0);
}

// Reverse logarithmic depth
fn reverseLogDepth(logDepth: f32, farPlane: f32) -> f32 {
  let C = 1.0;
  return (exp(logDepth * log(farPlane * C + 1.0)) - 1.0) / C;
}
`;
