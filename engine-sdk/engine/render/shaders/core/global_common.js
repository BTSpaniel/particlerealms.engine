// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Global Common - Shared frame uniforms structure
 * 
 * NOTE: This is a minimal FrameUniforms for simple shaders.
 * For camera-aware rendering, use:
 *   - cameraStructWGSL from modules/chunks/structs_common.js
 *   - frameUniformsWGSL from modules/chunks/structs_common.js
 */

// Minimal frame uniforms (just viewProj)
export const minimalFrameUniformsWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;
`;

// Export for backwards compatibility
export const globalCommonWGSL = minimalFrameUniformsWGSL;
