// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSPHSurfaceRenderer.js - SPH Fluid Surface Renderer (GAP 44)
 * 
 * Screen-space rendering of SPH fluid particles as smooth liquid surface.
 * Bridges SPH particle data (GAP 36) into the existing FluidWaterPass pipeline.
 * 
 * Pipeline:
 *   1. Render SPH particles as sphere impostors → depth texture
 *   2. Bilateral blur → smooth surface
 *   3. Thickness accumulation → subsurface scattering
 *   4. Composite with refraction + reflection + Fresnel
 * 
 * Per-element tint from element table: water=blue, lava=orange, blood=red.
 * 
 * Usage:
 *   const ssr = createSPHSurfaceRenderer(device, format, width, height);
 *   initSPHSurfaceBindGroups(ssr, device, positionBuffer, velocityBuffer, elementBuffer, colorLutBuffer);
 *   renderSPHSurface(ssr, encoder, { sceneColor, sceneDepth, camera, particleCount });
 */

import { calcWGSLStructSize } from "../../core/gpu/WGSLStructSize.js";

// ============================================================================
// SPH DEPTH PASS — render particles as sphere impostors to depth
// ============================================================================

const SPH_DEPTH_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  particleRadius: f32,
  viewRight: vec3<f32>,
  nearPlane: f32,
  viewUp: vec3<f32>,
  farPlane: f32,
  resolution: vec2<f32>,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) viewPos: vec3<f32>,
  @location(1) localUV: vec2<f32>,
  @location(2) @interpolate(flat) particleIdx: u32,
};

const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;

  let pos4 = positions[iid];
  let vel4 = velocities[iid];
  if (pos4.w >= vel4.w) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  // GAP 10: Phase mask — only render liquid particles (phase ~1.0) as SSFR surface
  let phase = thermalData[iid].y;
  if (phase < 0.5 || phase > 1.5) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  let center = pos4.xyz;
  let corner = CORNERS[vid % 6u];
  let r = frame.particleRadius;

  // Billboard in view space
  let worldPos = center + frame.viewRight * corner.x * r + frame.viewUp * corner.y * r;
  let viewPos = (frame.view * vec4<f32>(worldPos, 1.0)).xyz;

  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.viewPos = viewPos;
  out.localUV = corner;
  out.particleIdx = iid;

  return out;
}

struct FSOut {
  @location(0) eyeSpaceDepth: vec4<f32>,
};

@fragment
fn fs_main(in: VSOut) -> FSOut {
  var out: FSOut;

  // Sphere impostor: check if pixel is inside sphere
  let dist2 = dot(in.localUV, in.localUV);
  if (dist2 > 1.0) { discard; }

  // Sphere normal in view space
  let normalZ = sqrt(1.0 - dist2);
  let sphereOffset = vec3<f32>(in.localUV, normalZ) * frame.particleRadius;

  // Eye-space depth
  let eyeZ = in.viewPos.z - sphereOffset.z;

  // Output: linear eye-space depth + normal for later shading
  out.eyeSpaceDepth = vec4<f32>(-eyeZ, normalZ, in.localUV);

  return out;
}
`;

// ============================================================================
// BILATERAL BLUR PASS — smooth depth texture into continuous surface
// Narrow-range bilateral filter: only averages depth values within a threshold
// to preserve edges between fluid/non-fluid and at silhouettes.
// ============================================================================

const SPH_BLUR_SHADER = /* wgsl */`
struct BlurParams {
  texelSize: vec2<f32>,  // 1.0 / textureSize
  filterRadius: f32,     // kernel radius in pixels (default 4)
  depthThreshold: f32,   // narrow-range threshold (default 5.0)
  direction: vec2<f32>,  // (1,0) for horizontal, (0,1) for vertical
  _pad: vec2<f32>,
};

@group(0) @binding(0) var inputDepth: texture_2d<f32>;
@group(0) @binding(1) var depthSampler: sampler;
@group(0) @binding(2) var<uniform> blurParams: BlurParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32((vid & 1u) * 2u) - 1.0;
  let y = f32(((vid >> 1u) & 1u) * 2u) - 1.0;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>(x * 0.5 + 0.5, -y * 0.5 + 0.5);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let center = textureSampleLevel(inputDepth, depthSampler, in.uv, 0.0);
  let centerDepth = center.x;
  
  // No fluid: pass through
  if (centerDepth < 0.001) {
    return center;
  }
  
  let radius = i32(blurParams.filterRadius);
  let threshold = blurParams.depthThreshold;
  let step = blurParams.texelSize * blurParams.direction;
  
  var sumDepth = centerDepth;
  var sumNormalZ = center.y;
  var sumUV = center.zw;
  var weight = 1.0;
  
  // 1D bilateral blur with Gaussian spatial + narrow-range depth weight
  for (var i = 1; i <= 8; i++) {
    if (i > radius) { break; }
    let fi = f32(i);
    let spatialW = exp(-0.5 * fi * fi / (blurParams.filterRadius * blurParams.filterRadius * 0.25));
    
    // Positive offset
    let uvP = in.uv + step * fi;
    let sampleP = textureSampleLevel(inputDepth, depthSampler, uvP, 0.0);
    let depthDiffP = abs(sampleP.x - centerDepth);
    let rangeWP = select(0.0, 1.0, depthDiffP < threshold && sampleP.x > 0.001);
    let wP = spatialW * rangeWP;
    sumDepth += sampleP.x * wP;
    sumNormalZ += sampleP.y * wP;
    sumUV += sampleP.zw * wP;
    weight += wP;
    
    // Negative offset
    let uvN = in.uv - step * fi;
    let sampleN = textureSampleLevel(inputDepth, depthSampler, uvN, 0.0);
    let depthDiffN = abs(sampleN.x - centerDepth);
    let rangeWN = select(0.0, 1.0, depthDiffN < threshold && sampleN.x > 0.001);
    let wN = spatialW * rangeWN;
    sumDepth += sampleN.x * wN;
    sumNormalZ += sampleN.y * wN;
    sumUV += sampleN.zw * wN;
    weight += wN;
  }
  
  let invW = 1.0 / max(weight, 0.001);
  return vec4<f32>(sumDepth * invW, sumNormalZ * invW, sumUV * invW);
}
`;

// ============================================================================
// THICKNESS PASS — additive accumulation for subsurface scattering
// Renders same particles with additive blending, outputting a thickness value.
// ============================================================================

const SPH_THICKNESS_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  particleRadius: f32,
  viewRight: vec3<f32>,
  nearPlane: f32,
  viewUp: vec3<f32>,
  farPlane: f32,
  resolution: vec2<f32>,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localUV: vec2<f32>,
};

const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  let pos4 = positions[iid];
  let vel4 = velocities[iid];
  if (pos4.w >= vel4.w) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  // GAP 10: Phase mask — only render liquid particles as SSFR thickness
  let phase = thermalData[iid].y;
  if (phase < 0.5 || phase > 1.5) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  let center = pos4.xyz;
  let corner = CORNERS[vid % 6u];
  let r = frame.particleRadius;
  let worldPos = center + frame.viewRight * corner.x * r + frame.viewUp * corner.y * r;
  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.localUV = corner;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dist2 = dot(in.localUV, in.localUV);
  if (dist2 > 1.0) { discard; }
  // Smooth sphere profile for thickness contribution
  let thickness = sqrt(1.0 - dist2) * 0.5;
  return vec4<f32>(thickness, 0.0, 0.0, 1.0);
}
`;

// ============================================================================
// SPH COMPOSITE — full SSFR: smoothed depth → normals → refraction + Fresnel + specular
// Uses smoothed depth to reconstruct screen-space normals, thickness for absorption.
// ============================================================================

const SPH_COMPOSITE_SHADER = /* wgsl */`
struct CompositeParams {
  refractionStrength: f32,
  reflectivity: f32,
  tintR: f32,
  tintG: f32,
  tintB: f32,
  specularPower: f32,
  fresnelBias: f32,
  fresnelScale: f32,
  texelSizeX: f32,
  texelSizeY: f32,
  absorptionCoeff: f32,
  _pad: f32,
};

@group(0) @binding(0) var sceneColor: texture_2d<f32>;
@group(0) @binding(1) var fluidDepth: texture_2d<f32>;
@group(0) @binding(2) var fluidThickness: texture_2d<f32>;
@group(0) @binding(3) var sceneSampler: sampler;
@group(0) @binding(4) var<uniform> params: CompositeParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32((vid & 1u) * 2u) - 1.0;
  let y = f32(((vid >> 1u) & 1u) * 2u) - 1.0;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>(x * 0.5 + 0.5, -y * 0.5 + 0.5);
  return out;
}

// Reconstruct normal from smoothed depth using screen-space finite differences
fn reconstructNormal(uv: vec2<f32>, texelSize: vec2<f32>) -> vec3<f32> {
  let dc = textureSampleLevel(fluidDepth, sceneSampler, uv, 0.0).x;
  let dr = textureSampleLevel(fluidDepth, sceneSampler, uv + vec2<f32>(texelSize.x, 0.0), 0.0).x;
  let du = textureSampleLevel(fluidDepth, sceneSampler, uv + vec2<f32>(0.0, texelSize.y), 0.0).x;
  
  let dxdz = (dr - dc) / texelSize.x;
  let dydz = (du - dc) / texelSize.y;
  
  return normalize(vec3<f32>(-dxdz * 0.001, -dydz * 0.001, 1.0));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let fluidData = textureSampleLevel(fluidDepth, sceneSampler, in.uv, 0.0);
  let sceneCol = textureSampleLevel(sceneColor, sceneSampler, in.uv, 0.0);
  let depth = fluidData.x;
  
  // No fluid: pass through
  if (depth < 0.001) {
    return sceneCol;
  }
  
  // Reconstruct normals from smoothed depth
  let texelSize = vec2<f32>(params.texelSizeX, params.texelSizeY);
  let normal = reconstructNormal(in.uv, texelSize);
  
  // Thickness for absorption
  let thickness = textureSampleLevel(fluidThickness, sceneSampler, in.uv, 0.0).x;
  
  // Refraction: offset UV by normal.xy scaled by thickness
  let refractOffset = normal.xy * params.refractionStrength * 0.02 * (1.0 + thickness);
  let refractedUV = clamp(in.uv + refractOffset, vec2<f32>(0.001), vec2<f32>(0.999));
  let refractedColor = textureSampleLevel(sceneColor, sceneSampler, refractedUV, 0.0).rgb;
  
  // Beer-Lambert absorption through fluid thickness
  let tint = vec3<f32>(params.tintR, params.tintG, params.tintB);
  let absorption = exp(-thickness * params.absorptionCoeff * (vec3<f32>(1.0) - tint));
  let tintedColor = refractedColor * absorption;
  
  // Fresnel (Schlick approximation)
  let viewDot = max(normal.z, 0.0);
  let fresnel = params.fresnelBias + params.fresnelScale * pow(1.0 - viewDot, 5.0);
  
  // GAP 7: Screen-space reflection — reflect UV by surface normal to sample scene
  // Reflected UV: flip vertically + offset by normal for fake planar SSR
  let reflectOffset = normal.xy * vec2<f32>(0.15, -0.15);
  let reflectUV = clamp(vec2<f32>(in.uv.x + reflectOffset.x, 1.0 - in.uv.y + reflectOffset.y), vec2<f32>(0.001), vec2<f32>(0.999));
  let ssrColor = textureSampleLevel(sceneColor, sceneSampler, reflectUV, 0.0).rgb;
  // Fallback sky gradient for grazing angles where SSR is unreliable
  let skyGradient = mix(vec3<f32>(0.6, 0.75, 0.95), vec3<f32>(0.3, 0.5, 0.85), in.uv.y);
  // Blend SSR with sky based on how much the reflected UV stays on-screen
  let ssrConfidence = smoothstep(0.0, 0.1, reflectUV.y) * smoothstep(1.0, 0.9, reflectUV.y);
  let reflectedColor = mix(skyGradient, ssrColor, ssrConfidence) * fresnel * params.reflectivity;
  
  // Specular highlight (Blinn-Phong with fixed light)
  let lightDir = normalize(vec3<f32>(0.5, 0.7, 0.3));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let halfVec = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfVec), 0.0), params.specularPower);
  let specular = vec3<f32>(1.0) * spec * params.reflectivity;
  
  // Diffuse lighting
  let ndl = max(dot(normal, lightDir), 0.0);
  let diffuse = tintedColor * (0.3 + ndl * 0.7);
  
  // Combine: diffuse + reflection + specular
  let fluidColor = mix(diffuse, reflectedColor, fresnel) + specular;
  
  // Alpha based on depth + thickness
  let alpha = clamp(depth * 0.05 + thickness * 2.0, 0.4, 0.95);
  
  let outColor = mix(sceneCol.rgb, fluidColor, alpha);
  return vec4<f32>(outColor, 1.0);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the SPH surface renderer.
 * Full SSFR pipeline: depth → bilateral blur (H+V) → thickness → normals + composite.
 */
export function createSPHSurfaceRenderer(device, format, width, height) {
  const scale = 0.5; // render at half res
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));

  // Fluid depth texture (eye-space depth + normal)
  const depthTexture = device.createTexture({
    label: 'SPHSurface.depth',
    size: [w, h], format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Blur ping-pong textures (same format as depth)
  const blurTextureA = device.createTexture({
    label: 'SPHSurface.blurA',
    size: [w, h], format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const blurTextureB = device.createTexture({
    label: 'SPHSurface.blurB',
    size: [w, h], format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Thickness texture (R16float, additive)
  const thicknessTexture = device.createTexture({
    label: 'SPHSurface.thickness',
    size: [w, h], format: 'r16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Depth pass pipeline
  const depthModule = device.createShaderModule({ label: 'SPHSurface.depth', code: SPH_DEPTH_SHADER });
  const depthPipeline = device.createRenderPipeline({
    label: 'SPHSurface.depth.pipeline',
    layout: 'auto',
    vertex: { module: depthModule, entryPoint: 'vs_main' },
    fragment: {
      module: depthModule, entryPoint: 'fs_main',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Bilateral blur pipeline
  const blurModule = device.createShaderModule({ label: 'SPHSurface.blur', code: SPH_BLUR_SHADER });
  const blurPipeline = device.createRenderPipeline({
    label: 'SPHSurface.blur.pipeline',
    layout: 'auto',
    vertex: { module: blurModule, entryPoint: 'vs_main' },
    fragment: {
      module: blurModule, entryPoint: 'fs_main',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-strip' },
  });

  // Thickness pass pipeline (additive blend)
  const thicknessModule = device.createShaderModule({ label: 'SPHSurface.thickness', code: SPH_THICKNESS_SHADER });
  const thicknessPipeline = device.createRenderPipeline({
    label: 'SPHSurface.thickness.pipeline',
    layout: 'auto',
    vertex: { module: thicknessModule, entryPoint: 'vs_main' },
    fragment: {
      module: thicknessModule, entryPoint: 'fs_main',
      targets: [{
        format: 'r16float',
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Composite pipeline
  const compModule = device.createShaderModule({ label: 'SPHSurface.comp', code: SPH_COMPOSITE_SHADER });
  const compositePipeline = device.createRenderPipeline({
    label: 'SPHSurface.comp.pipeline',
    layout: 'auto',
    vertex: { module: compModule, entryPoint: 'vs_main' },
    fragment: {
      module: compModule, entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-strip' },
  });

  // Frame uniform buffer
  const frameBufferSize = calcWGSLStructSize(`struct FrameUniforms {
    viewProj: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cameraPos: vec3<f32>, particleRadius: f32,
    viewRight: vec3<f32>, nearPlane: f32,
    viewUp: vec3<f32>, farPlane: f32,
    resolution: vec2<f32>, _pad0: f32, _pad1: f32,
  }`);
  const frameBuffer = device.createBuffer({
    label: 'SPHSurface.frame', size: frameBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Blur params buffer (2 × for H/V passes)
  const blurParamsSize = 32; // 8 floats
  const blurParamsBufferH = device.createBuffer({
    label: 'SPHSurface.blurParamsH', size: blurParamsSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const blurParamsBufferV = device.createBuffer({
    label: 'SPHSurface.blurParamsV', size: blurParamsSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Composite params (expanded with texelSize + absorption)
  const compParamsSize = 48; // 12 floats
  const compositeParamsBuffer = device.createBuffer({
    label: 'SPHSurface.compParams', size: compParamsSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const sampler = device.createSampler({
    label: 'SPHSurface.sampler',
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  return {
    device, depthPipeline, blurPipeline, thicknessPipeline, compositePipeline,
    depthTexture, blurTextureA, blurTextureB, thicknessTexture,
    frameBuffer, blurParamsBufferH, blurParamsBufferV,
    compositeParamsBuffer, sampler,
    depthBindGroup: null, dataBindGroup: null, compositeBindGroup: null,
    blurBindGroupH: null, blurBindGroupV: null,
    thicknessBindGroup: null, thicknessDataBindGroup: null,
    width: w, height: h,
    // Config
    particleRadius: 0.3,
    refractionStrength: 1.5,
    reflectivity: 0.4,
    tint: [0.3, 0.5, 0.9],  // water blue default
    specularPower: 64.0,
    fresnelBias: 0.04,
    fresnelScale: 0.96,
    blurRadius: 4,
    depthThreshold: 5.0,
    absorptionCoeff: 2.0,
  };
}

/**
 * Initialize bind groups for all SSFR passes.
 */
export function initSPHSurfaceBindGroups(renderer, device, positionBuffer, velocityBuffer, thermalBuffer) {
  // Depth pass bind groups
  renderer.depthBindGroup = device.createBindGroup({
    label: 'SPHSurface.depth.frame',
    layout: renderer.depthPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }],
  });
  renderer.dataBindGroup = device.createBindGroup({
    label: 'SPHSurface.depth.data',
    layout: renderer.depthPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: velocityBuffer } },
      { binding: 2, resource: { buffer: thermalBuffer } },
    ],
  });

  // Upload blur params (horizontal)
  const texelX = 1.0 / renderer.width;
  const texelY = 1.0 / renderer.height;
  const blurH = new Float32Array([texelX, texelY, renderer.blurRadius, renderer.depthThreshold, 1, 0, 0, 0]);
  device.queue.writeBuffer(renderer.blurParamsBufferH, 0, blurH);
  // Upload blur params (vertical)
  const blurV = new Float32Array([texelX, texelY, renderer.blurRadius, renderer.depthThreshold, 0, 1, 0, 0]);
  device.queue.writeBuffer(renderer.blurParamsBufferV, 0, blurV);

  // Blur pass H: reads depthTexture, writes blurTextureA
  renderer.blurBindGroupH = device.createBindGroup({
    label: 'SPHSurface.blur.H',
    layout: renderer.blurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: renderer.depthTexture.createView() },
      { binding: 1, resource: renderer.sampler },
      { binding: 2, resource: { buffer: renderer.blurParamsBufferH } },
    ],
  });
  // Blur pass V: reads blurTextureA, writes blurTextureB (final smoothed depth)
  renderer.blurBindGroupV = device.createBindGroup({
    label: 'SPHSurface.blur.V',
    layout: renderer.blurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: renderer.blurTextureA.createView() },
      { binding: 1, resource: renderer.sampler },
      { binding: 2, resource: { buffer: renderer.blurParamsBufferV } },
    ],
  });

  // Thickness pass bind groups (reuse frame + data from depth pass)
  renderer.thicknessBindGroup = device.createBindGroup({
    label: 'SPHSurface.thickness.frame',
    layout: renderer.thicknessPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }],
  });
  renderer.thicknessDataBindGroup = device.createBindGroup({
    label: 'SPHSurface.thickness.data',
    layout: renderer.thicknessPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: velocityBuffer } },
      { binding: 2, resource: { buffer: thermalBuffer } },
    ],
  });
}

/**
 * Create composite bind group (needs scene color texture view).
 * Reads smoothed depth (blurTextureB) + thickness for full SSFR composite.
 */
export function initSPHCompositeBindGroup(renderer, device, sceneColorView) {
  // Composite reads smoothed depth (blurTextureB) and thickness
  renderer.compositeBindGroup = device.createBindGroup({
    label: 'SPHSurface.comp.bg',
    layout: renderer.compositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneColorView },
      { binding: 1, resource: renderer.blurTextureB.createView() },
      { binding: 2, resource: renderer.thicknessTexture.createView() },
      { binding: 3, resource: renderer.sampler },
      { binding: 4, resource: { buffer: renderer.compositeParamsBuffer } },
    ],
  });
}

/**
 * Set fluid tint color (e.g., from element).
 */
export function setSPHSurfaceTint(renderer, r, g, b) {
  if (!renderer) return;
  renderer.tint = [r, g, b];
}

/**
 * Render SPH fluid surface (full SSFR pipeline).
 * Pass 1: Depth (sphere impostors)
 * Pass 2: Bilateral blur H
 * Pass 3: Bilateral blur V
 * Pass 4: Thickness (additive)
 * @param {GPUCommandEncoder} encoder
 * @param {Object} options - { particleCount, viewProj, view, proj, cameraPos, viewRight, viewUp }
 */
export function renderSPHSurface(renderer, encoder, options) {
  if (!renderer?.depthBindGroup || !renderer.dataBindGroup) return;
  const { particleCount = 0, viewProj, view, proj, cameraPos, viewRight, viewUp } = options;
  if (particleCount === 0) return;

  // Upload frame uniforms
  const f = new Float32Array(64);
  if (viewProj) f.set(viewProj, 0);
  if (view) f.set(view, 16);
  if (proj) f.set(proj, 32);
  if (cameraPos) { f[48] = cameraPos[0]; f[49] = cameraPos[1]; f[50] = cameraPos[2]; }
  f[51] = renderer.particleRadius;
  if (viewRight) { f[52] = viewRight[0]; f[53] = viewRight[1]; f[54] = viewRight[2]; }
  f[55] = 0.1; // nearPlane
  if (viewUp) { f[56] = viewUp[0]; f[57] = viewUp[1]; f[58] = viewUp[2]; }
  f[59] = 1000.0; // farPlane
  f[60] = renderer.width; f[61] = renderer.height;
  renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, f);

  // Upload composite params (expanded: 12 floats)
  const cp = new Float32Array(12);
  cp[0] = renderer.refractionStrength;
  cp[1] = renderer.reflectivity;
  cp[2] = renderer.tint[0]; cp[3] = renderer.tint[1]; cp[4] = renderer.tint[2];
  cp[5] = renderer.specularPower;
  cp[6] = renderer.fresnelBias;
  cp[7] = renderer.fresnelScale;
  cp[8] = 1.0 / renderer.width;   // texelSizeX
  cp[9] = 1.0 / renderer.height;  // texelSizeY
  cp[10] = renderer.absorptionCoeff;
  cp[11] = 0; // pad
  renderer.device.queue.writeBuffer(renderer.compositeParamsBuffer, 0, cp);

  // Pass 1: Depth (sphere impostors → eye-space depth)
  const depthPass = encoder.beginRenderPass({
    label: 'SPHSurface.depth',
    colorAttachments: [{
      view: renderer.depthTexture.createView(),
      loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 },
      storeOp: 'store',
    }],
  });
  depthPass.setPipeline(renderer.depthPipeline);
  depthPass.setBindGroup(0, renderer.depthBindGroup);
  depthPass.setBindGroup(1, renderer.dataBindGroup);
  depthPass.draw(6, particleCount);
  depthPass.end();

  // Pass 2: Bilateral blur horizontal (depth → blurA)
  if (renderer.blurBindGroupH) {
    const blurHPass = encoder.beginRenderPass({
      label: 'SPHSurface.blur.H',
      colorAttachments: [{
        view: renderer.blurTextureA.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    blurHPass.setPipeline(renderer.blurPipeline);
    blurHPass.setBindGroup(0, renderer.blurBindGroupH);
    blurHPass.draw(4);
    blurHPass.end();
  }

  // Pass 3: Bilateral blur vertical (blurA → blurB = final smoothed depth)
  if (renderer.blurBindGroupV) {
    const blurVPass = encoder.beginRenderPass({
      label: 'SPHSurface.blur.V',
      colorAttachments: [{
        view: renderer.blurTextureB.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    blurVPass.setPipeline(renderer.blurPipeline);
    blurVPass.setBindGroup(0, renderer.blurBindGroupV);
    blurVPass.draw(4);
    blurVPass.end();
  }

  // Pass 4: Thickness (additive accumulation)
  if (renderer.thicknessBindGroup) {
    const thickPass = encoder.beginRenderPass({
      label: 'SPHSurface.thickness',
      colorAttachments: [{
        view: renderer.thicknessTexture.createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    thickPass.setPipeline(renderer.thicknessPipeline);
    thickPass.setBindGroup(0, renderer.thicknessBindGroup);
    thickPass.setBindGroup(1, renderer.thicknessDataBindGroup);
    thickPass.draw(6, particleCount);
    thickPass.end();
  }
}

/**
 * Composite SPH surface onto the scene in a render pass.
 */
export function compositeSPHSurface(pass, renderer) {
  if (!renderer?.compositePipeline || !renderer.compositeBindGroup) return;
  pass.setPipeline(renderer.compositePipeline);
  pass.setBindGroup(0, renderer.compositeBindGroup);
  pass.draw(4);
}

/**
 * Destroy.
 */
export function destroySPHSurfaceRenderer(renderer) {
  if (!renderer) return;
  if (renderer.depthTexture) renderer.depthTexture.destroy();
  if (renderer.blurTextureA) renderer.blurTextureA.destroy();
  if (renderer.blurTextureB) renderer.blurTextureB.destroy();
  if (renderer.thicknessTexture) renderer.thicknessTexture.destroy();
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.blurParamsBufferH) renderer.blurParamsBufferH.destroy();
  if (renderer.blurParamsBufferV) renderer.blurParamsBufferV.destroy();
  if (renderer.compositeParamsBuffer) renderer.compositeParamsBuffer.destroy();
}
