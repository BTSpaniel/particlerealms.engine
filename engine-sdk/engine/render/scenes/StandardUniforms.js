// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { getEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";

// Cached Uint32Array view for lightsData to avoid per-frame allocations
let _cachedLightsU32 = null;
let _cachedLightsBuffer = null;

// Light types matching WGSL shader
const LIGHT_TYPE_POINT = 0;
const LIGHT_TYPE_DIRECTIONAL = 1;
const LIGHT_TYPE_SPOT = 2;

// Each light uses 12 floats in the buffer:
// [0-2] position.xyz, [3] lightType (as u32 bits)
// [4-6] color.xyz, [7] innerCone
// [8-10] direction.xyz, [11] outerCone
const LIGHT_STRIDE = 12;

function getLightTypeId(typeString) {
  if (typeString === "directional") return LIGHT_TYPE_DIRECTIONAL;
  if (typeString === "spot") return LIGHT_TYPE_SPOT;
  return LIGHT_TYPE_POINT;
}

export function updateStandardLights(device, lightsBuffer, lightsData, options = {}) {
  if (!device || !lightsBuffer || !lightsData) {
    return 0;
  }

  const ecsWorld = options.ecsWorld || null;
  const lightEntityId = options.lightEntityId;
  const baseHeight = Number.isFinite(options.baseHeight) ? options.baseHeight : 0;

  let intensity = Number(options.intensity);
  if (!Number.isFinite(intensity)) {
    intensity = 1.5;
  }

  // Default light values
  let lightType = LIGHT_TYPE_POINT;
  let color = [1, 1, 1];
  let direction = [0, -1, 0];
  let innerConeAngle = 0.3;
  let outerConeAngle = 0.5;
  let position = [0, baseHeight, 0];

  // Read from ECS light component if available
  if (ecsWorld && lightEntityId !== null && lightEntityId !== undefined) {
    const light = getEntityComponent(ecsWorld, lightEntityId, "Light");
    if (light) {
      if (typeof light.intensity === "number") {
        intensity = light.intensity;
      }
      lightType = getLightTypeId(light.type);
      if (Array.isArray(light.color) && light.color.length >= 3) {
        color = light.color;
      }
      if (Array.isArray(light.direction) && light.direction.length >= 3) {
        direction = light.direction;
      }
      if (typeof light.innerConeAngle === "number") {
        innerConeAngle = light.innerConeAngle;
      }
      if (typeof light.outerConeAngle === "number") {
        outerConeAngle = light.outerConeAngle;
      }
    }

    // Get position from Transform component
    const transform = getEntityComponent(ecsWorld, lightEntityId, "Transform");
    if (transform && Array.isArray(transform.position) && transform.position.length >= 3) {
      position = transform.position;
    }
  }

  // Convert cone angles to cosines for shader (cos is monotonically decreasing, so inner > outer)
  const innerConeCos = Math.cos(innerConeAngle);
  const outerConeCos = Math.cos(outerConeAngle);

  // Normalize direction
  const dirLen = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
  const normDir = dirLen > 0.0001 ? [direction[0] / dirLen, direction[1] / dirLen, direction[2] / dirLen] : [0, -1, 0];

  const brightnessScale = intensity / 20.0;
  const baseIntensity = 15.0 * brightnessScale;

  const base = 0;

  // Position (vec3) + lightType (u32 as bits in f32)
  lightsData[base + 0] = position[0];
  lightsData[base + 1] = position[1];
  lightsData[base + 2] = position[2];
  // Store lightType as u32 bits - reuse cached view to avoid GC pressure
  if (_cachedLightsBuffer !== lightsData.buffer) {
    _cachedLightsBuffer = lightsData.buffer;
    _cachedLightsU32 = new Uint32Array(lightsData.buffer, lightsData.byteOffset, lightsData.length);
  }
  _cachedLightsU32[base + 3] = lightType;

  // Color (vec3) + innerCone (f32)
  lightsData[base + 4] = color[0] * baseIntensity;
  lightsData[base + 5] = color[1] * baseIntensity;
  lightsData[base + 6] = color[2] * baseIntensity;
  lightsData[base + 7] = innerConeCos;

  // Direction (vec3) + outerCone (f32)
  lightsData[base + 8] = normDir[0];
  lightsData[base + 9] = normDir[1];
  lightsData[base + 10] = normDir[2];
  lightsData[base + 11] = outerConeCos;

  updateBuffer(device, lightsBuffer, lightsData);
  return 1;
}

export function updateStandardUniforms(device, targetBuffer, uniformData, uniformDataU32, options = {}) {
  if (!device || !targetBuffer || !uniformData || !uniformDataU32) {
    return;
  }

  const projection = options.projection;
  const view = options.view;
  const modelMatrix = options.modelMatrix;
  const baseColor = options.baseColor || [1, 1, 1];
  const lightCount = Number.isFinite(options.lightCount) ? options.lightCount : 0;
  const alpha = Number.isFinite(options.alpha) ? options.alpha : 1.0;

  if (!projection || !view || !modelMatrix) {
    return;
  }

  // Layout matches Uniforms struct in standard.wgsl
  // [0..15]   projection (mat4x4)
  // [16..31]  view (mat4x4)
  // [32..47]  model (mat4x4)
  // [48..50]  color.xyz (vec3)
  // [51]      alpha
  // [52]      lightCount (u32)
  // [53]      _pad1 (u32)
  // [54..56]  sunDir.xyz (vec3)
  // [57]      _pad2 (f32)
  // [58..60]  sunColor.xyz (vec3)
  // [61]      _pad3 (f32)
  // [62..65]  feature flags (u32)

  uniformData.set(projection, 0);
  uniformData.set(view, 16);
  uniformData.set(modelMatrix, 32);

  uniformData[48] = baseColor[0];
  uniformData[49] = baseColor[1];
  uniformData[50] = baseColor[2];
  uniformData[51] = alpha;

  const clampedCount = lightCount < 0 ? 0 : lightCount;
  uniformDataU32[52] = clampedCount >>> 0;
  uniformDataU32[53] = 0; // _pad1

  // Simple sun from above/right
  uniformData[54] = 0.4;
  uniformData[55] = 0.8;
  uniformData[56] = -0.3;
  uniformData[57] = 0.0; // _pad2

  uniformData[58] = 1.0;
  uniformData[59] = 0.9;
  uniformData[60] = 0.7;
  uniformData[61] = 0.0; // _pad3

  const enableDiffuse = !!options.enableDiffuse;
  const enableBounce = !!options.enableBounce;
  const enableEmissive = !!options.enableEmissive;
  const enableSun = !!options.enableSun;

  uniformDataU32[62] = enableDiffuse ? 1 : 0;
  uniformDataU32[63] = enableBounce ? 1 : 0;
  uniformDataU32[64] = enableEmissive ? 1 : 0;
  uniformDataU32[65] = enableSun ? 1 : 0;

  updateBuffer(device, targetBuffer, uniformData);
}
