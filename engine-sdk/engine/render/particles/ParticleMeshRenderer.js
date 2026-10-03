// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleMeshRenderer.js - Instanced Mesh Particle Renderer (GAP 9)
 * 
 * Renders each particle as a 3D mesh instance instead of a billboard.
 * Supports both regular triangle meshes AND voxel meshes (compact u32 format).
 * 
 * Each particle's position/velocity/meta drives a mesh instance:
 *   - Position from particle positions buffer
 *   - Rotation from velocity direction (velocity-aligned) or billboard
 *   - Scale from meta.w packed size
 *   - Color tint from meta.rgb
 *   - Age-based fade from pos.w / vel.w
 * 
 * Usage:
 *   const renderer = await createParticleMeshRenderer(device, { format, mesh });
 *   // In render loop:
 *   renderMeshParticles(pass, renderer, world, { viewProj, instanceCount });
 */

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { DynamicUniformBuffer } from "../../core/gpu/DynamicUniformBuffer.js";

// Mesh particle FrameUniforms — single source of truth for shader + CPU buffer
export const MESH_FRAME_STRUCT = `struct FrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDir: vec3<f32>,
  sunIntensity: f32,
  sunColor: vec3<f32>,
  ambientIntensity: f32,
  ambientColor: vec3<f32>,
  debugMode: f32,
}`;

// ============================================================================
// WGSL SHADER
// ============================================================================

const MESH_PARTICLE_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDir: vec3<f32>,
  sunIntensity: f32,
  sunColor: vec3<f32>,
  ambientIntensity: f32,
  ambientColor: vec3<f32>,
  debugMode: f32,
};

struct MeshParams {
  defaultSize: f32,
  alignMode: u32,
  fadeStart: f32,
  fadeEnd: f32,
  roughness: f32,
  metalness: f32,
  emissiveIntensity: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> meshParams: MeshParams;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) worldPos: vec3<f32>,
};

fn rotationFromDirection(dir: vec3<f32>) -> mat3x3<f32> {
  let forward = normalize(dir);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dot(forward, up)) > 0.99) {
    up = vec3<f32>(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(up, forward));
  let realUp = cross(forward, right);
  return mat3x3<f32>(right, realUp, forward);
}

@vertex
fn vs_main(
  @location(0) vertPos: vec3<f32>,
  @location(1) vertNormal: vec3<f32>,
  @location(2) vertColor: vec4<f32>,
  @builtin(instance_index) ii: u32,
) -> VertexOutput {
  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let metaVal = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let velocity = vel4.xyz;

  let packedValue = metaVal.w;
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;
  let size = max(particleSize, meshParams.defaultSize * 0.1);

  let t = clamp(age / lifetime, 0.0, 1.0);
  let isDead = select(1.0, 0.0, age >= lifetime);
  let fade = 1.0 - smoothstep(meshParams.fadeStart, meshParams.fadeEnd, t);

  var rot = mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
  );

  let speed = length(velocity);
  if (meshParams.alignMode == 0u && speed > 0.1) {
    rot = rotationFromDirection(velocity);
  } else if (meshParams.alignMode == 1u) {
    let toCamera = normalize(frame.cameraPos - center);
    rot = rotationFromDirection(toCamera);
  }

  let scaledVert = vertPos * size * isDead;
  let rotatedVert = rot * scaledVert;
  let worldPos = center + rotatedVert;
  let rotatedNormal = normalize(rot * vertNormal);

  var out: VertexOutput;
  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.color = vec4<f32>(metaVal.rgb * vertColor.rgb, vertColor.a * fade * isDead);
  out.normal = rotatedNormal;
  out.worldPos = worldPos;
  return out;
}

// ============ PBR BRDF (Cook-Torrance GGX) ============
const PI: f32 = 3.14159265;

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 0.0001);
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.color.a < 0.01) { discard; }

  let dm = u32(frame.debugMode);
  if (dm == 1u) { return vec4<f32>(input.normal * 0.5 + 0.5, input.color.a); }
  if (dm == 2u) { let d = input.position.z; return vec4<f32>(vec3<f32>(1.0 - d), input.color.a); }
  if (dm == 3u) { return vec4<f32>(vec3<f32>(0.7), input.color.a); }

  let albedo = input.color.rgb;
  let roughness = clamp(meshParams.roughness, 0.04, 1.0);
  let metalness = clamp(meshParams.metalness, 0.0, 1.0);
  let N = normalize(input.normal);
  let V = normalize(frame.cameraPos - input.worldPos);
  let L = normalize(-frame.sunDir);
  let H = normalize(V + L);

  let NdotL = max(dot(N, L), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let HdotV = max(dot(H, V), 0.0);

  // Dielectric F0=0.04, metallic F0=albedo
  let F0 = mix(vec3<f32>(0.04), albedo, metalness);

  // Cook-Torrance specular BRDF
  let D = distributionGGX(NdotH, roughness);
  let G = geometrySmith(NdotV, NdotL, roughness);
  let F = fresnelSchlick(HdotV, F0);

  let numerator = D * G * F;
  let denominator = 4.0 * NdotV * NdotL + 0.0001;
  let specular = numerator / denominator;

  // Energy conservation: metals absorb diffuse, dielectrics reflect it
  let kD = (vec3<f32>(1.0) - F) * (1.0 - metalness);
  let diffuse = kD * albedo / PI;

  let sunRadiance = frame.sunColor * frame.sunIntensity;
  let directLight = (diffuse + specular) * sunRadiance * NdotL;

  // Ambient (simple hemisphere)
  let ambContrib = frame.ambientColor * frame.ambientIntensity * albedo;

  // Subsurface scattering approximation for translucent particles
  let backLight = max(dot(-N, L), 0.0) * (1.0 - input.color.a) * 0.3;
  let sss = frame.sunColor * backLight * albedo;

  // Emissive glow (particle color * intensity)
  let emissive = albedo * meshParams.emissiveIntensity;

  let color = directLight + ambContrib + sss + emissive;
  return vec4<f32>(color, input.color.a);
}
`;

// Voxel mesh variant: uses packed u32 vertex format
const VOXEL_MESH_PARTICLE_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDir: vec3<f32>,
  sunIntensity: f32,
  sunColor: vec3<f32>,
  ambientIntensity: f32,
  ambientColor: vec3<f32>,
  debugMode: f32,
};

struct MeshParams {
  defaultSize: f32,
  alignMode: u32,
  fadeStart: f32,
  fadeEnd: f32,
  roughness: f32,
  metalness: f32,
  emissiveIntensity: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> meshParams: MeshParams;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;

// Material colors lookup table (matches VoxelMeshCompute.js)
const MATERIAL_COLORS: array<vec4<f32>, 25> = array<vec4<f32>, 25>(
  vec4<f32>(0.0, 0.0, 0.0, 0.0),
  vec4<f32>(0.502, 0.502, 0.549, 1.0),
  vec4<f32>(0.545, 0.353, 0.169, 1.0),
  vec4<f32>(0.337, 0.596, 0.231, 1.0),
  vec4<f32>(0.929, 0.788, 0.686, 1.0),
  vec4<f32>(0.118, 0.471, 0.784, 0.706),
  vec4<f32>(0.627, 0.471, 0.314, 1.0),
  vec4<f32>(0.176, 0.353, 0.176, 1.0),
  vec4<f32>(0.961, 0.961, 1.0, 1.0),
  vec4<f32>(0.627, 0.831, 0.91, 1.0),
  vec4<f32>(1.0, 0.314, 0.078, 1.0),
  vec4<f32>(0.235, 0.549, 0.235, 1.0),
  vec4<f32>(0.275, 0.275, 0.333, 1.0),
  vec4<f32>(0.118, 0.098, 0.157, 1.0),
  vec4<f32>(1.0, 0.392, 0.118, 1.0),
  vec4<f32>(0.706, 0.471, 1.0, 1.0),
  vec4<f32>(0.059, 0.039, 0.098, 1.0),
  vec4<f32>(0.549, 0.353, 0.706, 1.0),
  vec4<f32>(0.392, 0.275, 0.471, 1.0),
  vec4<f32>(0.784, 0.784, 0.863, 1.0),
  vec4<f32>(0.157, 0.137, 0.118, 1.0),
  vec4<f32>(0.471, 1.0, 0.314, 1.0),
  vec4<f32>(0.392, 0.373, 0.353, 1.0),
  vec4<f32>(0.706, 0.706, 0.765, 1.0),
  vec4<f32>(0.914, 0.271, 0.376, 1.0),
);

const FACE_NORMALS: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
  vec3<f32>(1.0, 0.0, 0.0),
  vec3<f32>(-1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(0.0, -1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0),
  vec3<f32>(0.0, 0.0, -1.0),
);

const AO_VALUES: array<f32, 4> = array<f32, 4>(1.0, 0.75, 0.5, 0.25);

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) worldPos: vec3<f32>,
};

fn rotationFromDirection(dir: vec3<f32>) -> mat3x3<f32> {
  let forward = normalize(dir);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dot(forward, up)) > 0.99) {
    up = vec3<f32>(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(up, forward));
  let realUp = cross(forward, right);
  return mat3x3<f32>(right, realUp, forward);
}

@vertex
fn vs_main(
  @location(0) packed: u32,
  @builtin(instance_index) ii: u32,
) -> VertexOutput {
  // Unpack voxel vertex (relative to chunk origin 0,0,0 since mesh is centered)
  let posX = f32(packed & 0x3Fu);
  let posY = f32((packed >> 6u) & 0x3Fu);
  let posZ = f32((packed >> 12u) & 0x3Fu);
  let normalIdx = (packed >> 18u) & 0x7u;
  let aoIdx = (packed >> 21u) & 0x3u;
  let materialIdx = (packed >> 23u) & 0x1Fu;

  let vertPos = vec3<f32>(posX, posY, posZ);
  let vertNormal = FACE_NORMALS[normalIdx];
  let vertColor = MATERIAL_COLORS[min(materialIdx, 24u)];
  let ao = AO_VALUES[aoIdx];

  // Particle instance data
  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let metaVal = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let velocity = vel4.xyz;

  let packedMeta = metaVal.w;
  let particleSize = (floor(packedMeta / 1e4) % 100.0) * 0.1;
  let size = max(particleSize, meshParams.defaultSize * 0.1) * 0.1; // Voxel meshes need smaller scale

  let t = clamp(age / lifetime, 0.0, 1.0);
  let isDead = select(1.0, 0.0, age >= lifetime);
  let fade = 1.0 - smoothstep(meshParams.fadeStart, meshParams.fadeEnd, t);

  // Center the voxel mesh (assume 32x32x32 chunk, center at 16,16,16)
  let centeredPos = (vertPos - vec3<f32>(16.0, 16.0, 16.0)) * size * isDead;

  var rot = mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
  );

  let speed = length(velocity);
  if (meshParams.alignMode == 0u && speed > 0.1) {
    rot = rotationFromDirection(velocity);
  } else if (meshParams.alignMode == 1u) {
    let toCamera = normalize(frame.cameraPos - center);
    rot = rotationFromDirection(toCamera);
  }

  let rotatedVert = rot * centeredPos;
  let worldPos = center + rotatedVert;
  let rotatedNormal = normalize(rot * vertNormal);

  var out: VertexOutput;
  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  // Tint voxel color by particle color, apply AO
  out.color = vec4<f32>(metaVal.rgb * vertColor.rgb * ao, vertColor.a * fade * isDead);
  out.normal = rotatedNormal;
  out.worldPos = worldPos;
  return out;
}

const PI_V: f32 = 3.14159265;

fn distributionGGX_v(NdotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI_V * d * d + 0.0001);
}

fn geometrySchlickGGX_v(NdotV: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

fn geometrySmith_v(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX_v(NdotV, roughness) * geometrySchlickGGX_v(NdotL, roughness);
}

fn fresnelSchlick_v(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.color.a < 0.01) { discard; }

  let dm = u32(frame.debugMode);
  if (dm == 1u) { return vec4<f32>(input.normal * 0.5 + 0.5, input.color.a); }
  if (dm == 2u) { let d = input.position.z; return vec4<f32>(vec3<f32>(1.0 - d), input.color.a); }
  if (dm == 3u) { return vec4<f32>(vec3<f32>(0.7), input.color.a); }

  let albedo = input.color.rgb;
  let roughness = clamp(meshParams.roughness, 0.04, 1.0);
  let metalness = clamp(meshParams.metalness, 0.0, 1.0);
  let N = normalize(input.normal);
  let V = normalize(frame.cameraPos - input.worldPos);
  let L = normalize(-frame.sunDir);
  let H = normalize(V + L);

  let NdotL = max(dot(N, L), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let HdotV = max(dot(H, V), 0.0);

  let F0 = mix(vec3<f32>(0.04), albedo, metalness);
  let D = distributionGGX_v(NdotH, roughness);
  let G = geometrySmith_v(NdotV, NdotL, roughness);
  let F = fresnelSchlick_v(HdotV, F0);
  let specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
  let kD = (vec3<f32>(1.0) - F) * (1.0 - metalness);
  let diffuse = kD * albedo / PI_V;

  let sunRadiance = frame.sunColor * frame.sunIntensity;
  let directLight = (diffuse + specular) * sunRadiance * NdotL;
  let ambContrib = frame.ambientColor * frame.ambientIntensity * albedo;
  let emissive = albedo * meshParams.emissiveIntensity;
  let color = directLight + ambContrib + emissive;

  return vec4<f32>(color, input.color.a);
}
`;

// ============================================================================
// SHADOW DEPTH SHADER (depth-only pass for shadow map generation)
// ============================================================================
// Renders mesh particles into a depth32float shadow map from the light's perspective.
// Uses a minimal vertex shader (position only) and no fragment output (depth-only).

const SHADOW_DEPTH_SHADER_STANDARD = /* wgsl */`
struct ShadowUniforms {
  lightViewProj: mat4x4<f32>,
  defaultSize: f32,
  alignMode: u32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;

fn rotationFromDir(dir: vec3<f32>) -> mat3x3<f32> {
  let forward = normalize(dir);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dot(forward, up)) > 0.99) { up = vec3<f32>(0.0, 0.0, 1.0); }
  let right = normalize(cross(up, forward));
  let realUp = cross(forward, right);
  return mat3x3<f32>(right, realUp, forward);
}

@vertex
fn vs_shadow(
  @location(0) vertPos: vec3<f32>,
  @location(1) vertNormal: vec3<f32>,
  @location(2) vertColor: vec4<f32>,
  @builtin(instance_index) ii: u32,
) -> @builtin(position) vec4<f32> {
  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let metaVal = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let isDead = select(1.0, 0.0, age >= lifetime);

  let packedValue = metaVal.w;
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;
  let size = max(particleSize, shadow.defaultSize * 0.1);

  var rot = mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
  );
  let speed = length(vel4.xyz);
  if (shadow.alignMode == 0u && speed > 0.1) {
    rot = rotationFromDir(vel4.xyz);
  }

  let worldPos = center + rot * (vertPos * size * isDead);
  return shadow.lightViewProj * vec4<f32>(worldPos, 1.0);
}
`;

const SHADOW_DEPTH_SHADER_VOXEL = /* wgsl */`
struct ShadowUniforms {
  lightViewProj: mat4x4<f32>,
  defaultSize: f32,
  alignMode: u32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;

fn rotationFromDir(dir: vec3<f32>) -> mat3x3<f32> {
  let forward = normalize(dir);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dot(forward, up)) > 0.99) { up = vec3<f32>(0.0, 0.0, 1.0); }
  let right = normalize(cross(up, forward));
  let realUp = cross(forward, right);
  return mat3x3<f32>(right, realUp, forward);
}

@vertex
fn vs_shadow(
  @location(0) packed: u32,
  @builtin(instance_index) ii: u32,
) -> @builtin(position) vec4<f32> {
  let posX = f32(packed & 0x3Fu);
  let posY = f32((packed >> 6u) & 0x3Fu);
  let posZ = f32((packed >> 12u) & 0x3Fu);
  let vertPos = vec3<f32>(posX, posY, posZ);

  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let metaVal = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let isDead = select(1.0, 0.0, age >= lifetime);

  let packedMeta = metaVal.w;
  let particleSize = (floor(packedMeta / 1e4) % 100.0) * 0.1;
  let size = max(particleSize, shadow.defaultSize * 0.1) * 0.1;

  var rot = mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
  );
  let speed = length(vel4.xyz);
  if (shadow.alignMode == 0u && speed > 0.1) {
    rot = rotationFromDir(vel4.xyz);
  }

  let centeredPos = (vertPos - vec3<f32>(16.0, 16.0, 16.0)) * size * isDead;
  let worldPos = center + rot * centeredPos;
  return shadow.lightViewProj * vec4<f32>(worldPos, 1.0);
}
`;

// ============================================================================
// ALIGNMENT MODES
// ============================================================================

export const MESH_ALIGN_VELOCITY = 0;
export const MESH_ALIGN_BILLBOARD = 1;
export const MESH_ALIGN_WORLD = 2;

// ============================================================================
// SYSTEM CREATION
// ============================================================================

/**
 * Create a particle mesh renderer.
 * @param {GPUDevice} device
 * @param {Object} options
 * @param {string} options.format - Canvas format (e.g. 'bgra8unorm')
 * @param {Object} options.mesh - { vertexBuffer, indexBuffer, indexCount, indexFormat }
 * @param {boolean} options.isVoxelMesh - true to use compact u32 voxel vertex format
 * @param {number} options.alignMode - MESH_ALIGN_VELOCITY, MESH_ALIGN_BILLBOARD, MESH_ALIGN_WORLD
 */
export async function createParticleMeshRenderer(device, options = {}) {
  const { format, isVoxelMesh = false, alignMode = MESH_ALIGN_VELOCITY } = options;
  if (!device) throw new Error('createParticleMeshRenderer: device required');
  if (!format) throw new Error('createParticleMeshRenderer: format required');

  const shaderCode = isVoxelMesh ? VOXEL_MESH_PARTICLE_SHADER : MESH_PARTICLE_SHADER;
  const shaderModule = device.createShaderModule({
    label: `ParticleMeshRenderer.shader.${isVoxelMesh ? 'voxel' : 'standard'}`,
    code: shaderCode,
  });

  // Vertex layout depends on mesh type
  const vertexBuffers = isVoxelMesh
    ? [{
        arrayStride: 4,
        stepMode: 'vertex',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }],
      }]
    : [{
        arrayStride: 40, // 10 floats (pos3 + normal3 + color4)
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
          { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
          { shaderLocation: 2, offset: 24, format: 'float32x4' },  // color
        ],
      }];

  // Bind group layouts
  const frameLayout = device.createBindGroupLayout({
    label: 'ParticleMeshRenderer.frameLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'ParticleMeshRenderer.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, dataLayout],
  });

  const pipeline = device.createRenderPipeline({
    label: `ParticleMeshRenderer.pipeline.${isVoxelMesh ? 'voxel' : 'standard'}`,
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: vertexBuffers,
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
      frontFace: 'ccw',
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  // Uniform buffers (auto-sized from WGSL struct)
  const frameUniform = new DynamicUniformBuffer(device, MESH_FRAME_STRUCT, 'ParticleMeshRenderer.frame');
  const frameBuffer = frameUniform.buffer;

  const meshParamsBuffer = device.createBuffer({
    label: 'ParticleMeshRenderer.meshParams',
    size: 32, // defaultSize(4) + alignMode(4) + fadeStart(4) + fadeEnd(4) + roughness(4) + metalness(4) + emissiveIntensity(4) + _pad(4) = 32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Initialize mesh params with PBR defaults
  const paramsData = new ArrayBuffer(32);
  const paramsF32 = new Float32Array(paramsData);
  const paramsU32 = new Uint32Array(paramsData);
  paramsF32[0] = options.defaultSize ?? 2.0;
  paramsU32[1] = alignMode;
  paramsF32[2] = options.fadeStart ?? 0.9;
  paramsF32[3] = options.fadeEnd ?? 1.0;
  paramsF32[4] = options.roughness ?? 0.5;           // PBR roughness (0=mirror, 1=diffuse)
  paramsF32[5] = options.metalness ?? 0.0;           // PBR metalness (0=dielectric, 1=metal)
  paramsF32[6] = options.emissiveIntensity ?? 0.0;   // Emissive glow strength
  paramsF32[7] = 0;                                  // _pad
  device.queue.writeBuffer(meshParamsBuffer, 0, new Uint8Array(paramsData));

  return {
    device,
    pipeline,
    frameLayout,
    dataLayout,
    frameBuffer,
    meshParamsBuffer,
    isVoxelMesh,
    mesh: null, // Set via setMesh()
    frameBindGroup: null,
    dataBindGroup: null,
    frameUniform,
    _frameData: new Float32Array(32), // legacy fallback
    _paramsData: paramsData,
    _vertexBuffers: vertexBuffers,
    // Shadow casting (lazily initialized via initShadowPipeline)
    shadowPipeline: null,
    shadowUniformLayout: null,
    shadowUniformBuffer: null,
    shadowBindGroup: null,
    shadowDataBindGroup: null,
    _shadowUniformData: null,
    castShadows: options.castShadows ?? false,
  };
}

/**
 * Set the mesh to render per particle.
 * @param {Object} renderer
 * @param {Object} mesh - { vertexBuffer, indexBuffer, indexCount, indexFormat? }
 */
export function setParticleMesh(renderer, mesh) {
  if (!renderer || !mesh) return;
  renderer.mesh = mesh;

  // Recreate frame bind group
  renderer.frameBindGroup = renderer.device.createBindGroup({
    label: 'ParticleMeshRenderer.frameBindGroup',
    layout: renderer.frameLayout,
    entries: [
      { binding: 0, resource: { buffer: renderer.frameBuffer } },
      { binding: 1, resource: { buffer: renderer.meshParamsBuffer } },
    ],
  });
}

/**
 * Bind particle data buffers from a particle world.
 * @param {Object} renderer
 * @param {Object} world - Particle world
 */
export function bindParticleData(renderer, world) {
  if (!renderer || !world) return;

  renderer.dataBindGroup = renderer.device.createBindGroup({
    label: 'ParticleMeshRenderer.dataBindGroup',
    layout: renderer.dataLayout,
    entries: [
      { binding: 0, resource: { buffer: world.positionBuffer } },
      { binding: 1, resource: { buffer: world.velocityBuffer } },
      { binding: 2, resource: { buffer: world.metaBuffer } },
    ],
  });
}

/**
 * Render mesh particles into a render pass.
 * @param {GPURenderPassEncoder} pass
 * @param {Object} renderer
 * @param {Object} options - { viewProj, cameraPos, time, instanceCount }
 */
export function renderMeshParticles(pass, renderer, options = {}) {
  if (!renderer?.pipeline || !renderer?.mesh || !renderer?.frameBindGroup || !renderer?.dataBindGroup) return;

  const { viewProj, cameraPos = [0, 0, 0], time = 0, instanceCount = 0, lightManager } = options;
  if (!viewProj || instanceCount <= 0) return;

  // Update frame uniforms via DynamicUniformBuffer (named fields, auto-sized)
  const lm = lightManager;
  const isUnlit = lm && lm.lightingMode === 'unlit';
  renderer.frameUniform.setAll({
    viewProj,
    cameraPos,
    time,
    sunDir:          lm ? lm.sunDirection : [0.2, -1.0, 0.1],
    sunIntensity:    isUnlit ? 0 : (lm ? (lm.enableSun ? lm.sunIntensity * lm.globalBrightness : 0) : 1.85),
    sunColor:        lm ? lm.sunColor : [1.0, 0.95, 0.85],
    ambientIntensity: isUnlit ? 1.0 : (lm ? lm.ambientIntensity : 0.3),
    ambientColor:    isUnlit ? [1.0, 1.0, 1.0] : (lm ? lm.ambientColor : [0.15, 0.15, 0.2]),
    debugMode:       lm ? (lm.debugMode || 0) : 0,
  });
  renderer.frameUniform.upload();

  // Draw
  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);

  const mesh = renderer.mesh;
  pass.setVertexBuffer(0, mesh.vertexBuffer);

  const indexFormat = mesh.indexFormat || (renderer.isVoxelMesh ? 'uint32' : 'uint32');
  if (mesh.indexBuffer) {
    pass.setIndexBuffer(mesh.indexBuffer, indexFormat);
    pass.drawIndexed(mesh.indexCount, instanceCount);
  } else {
    pass.draw(mesh.vertexCount, instanceCount);
  }
}

/**
 * Update mesh particle renderer params.
 */
export function setMeshParticleParams(renderer, params = {}) {
  if (!renderer?.device) return;
  const data = renderer._paramsData;
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);

  if (params.defaultSize !== undefined) f32[0] = params.defaultSize;
  if (params.alignMode !== undefined) u32[1] = params.alignMode;
  if (params.fadeStart !== undefined) f32[2] = params.fadeStart;
  if (params.fadeEnd !== undefined) f32[3] = params.fadeEnd;
  if (params.roughness !== undefined) f32[4] = params.roughness;
  if (params.metalness !== undefined) f32[5] = params.metalness;
  if (params.emissiveIntensity !== undefined) f32[6] = params.emissiveIntensity;

  renderer.device.queue.writeBuffer(renderer.meshParamsBuffer, 0, new Uint8Array(data));
}

/**
 * Lazily initialize the shadow depth pipeline for particle mesh shadow casting.
 * Call once before the first flushShadowDepth. Requires dataBindGroup to be set.
 * @param {Object} renderer
 */
export function initShadowPipeline(renderer) {
  if (!renderer?.device || renderer.shadowPipeline) return;
  const device = renderer.device;

  const shadowShaderCode = renderer.isVoxelMesh
    ? SHADOW_DEPTH_SHADER_VOXEL
    : SHADOW_DEPTH_SHADER_STANDARD;

  const shadowModule = device.createShaderModule({
    label: `ParticleMeshRenderer.shadow.${renderer.isVoxelMesh ? 'voxel' : 'standard'}`,
    code: shadowShaderCode,
  });

  // Shadow uniform layout: single uniform buffer with lightViewProj + params
  const shadowUniformLayout = device.createBindGroupLayout({
    label: 'ParticleMeshRenderer.shadowUniformLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  // Reuse the existing dataLayout for particle storage buffers (group 1)
  const shadowPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [shadowUniformLayout, renderer.dataLayout],
  });

  const shadowPipeline = device.createRenderPipeline({
    label: `ParticleMeshRenderer.shadowPipeline.${renderer.isVoxelMesh ? 'voxel' : 'standard'}`,
    layout: shadowPipelineLayout,
    vertex: {
      module: shadowModule,
      entryPoint: 'vs_shadow',
      buffers: renderer._vertexBuffers,
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
      frontFace: 'ccw',
    },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: 'less',
      depthBias: 2,
      depthBiasSlopeScale: 1.5,
    },
  });

  // ShadowUniforms buffer: lightViewProj(64) + defaultSize(4) + alignMode(4) + pad(8) = 80 bytes
  const shadowUniformBuffer = device.createBuffer({
    label: 'ParticleMeshRenderer.shadowUniforms',
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  renderer.shadowPipeline = shadowPipeline;
  renderer.shadowUniformLayout = shadowUniformLayout;
  renderer.shadowUniformBuffer = shadowUniformBuffer;
  renderer._shadowUniformData = new Float32Array(20); // 80 bytes = 20 floats

  // Create shadow uniform bind group
  renderer.shadowBindGroup = device.createBindGroup({
    label: 'ParticleMeshRenderer.shadowBindGroup',
    layout: shadowUniformLayout,
    entries: [
      { binding: 0, resource: { buffer: shadowUniformBuffer } },
    ],
  });
}

/**
 * Render mesh particles into a shadow depth pass (depth-only, no color).
 * Compatible with ShadowMapPass.renderShadowDepth().
 * @param {GPURenderPassEncoder} pass - Depth-only render pass
 * @param {Object} renderer - Particle mesh renderer
 * @param {Float32Array} lightViewProj - 4x4 light view-projection matrix (16 floats)
 * @param {number} instanceCount - Number of particle instances to draw
 */
export function flushShadowDepth(pass, renderer, lightViewProj, instanceCount) {
  if (!renderer?.shadowPipeline || !renderer?.mesh || !renderer?.dataBindGroup || !lightViewProj) return;
  if (instanceCount <= 0) return;

  // Upload shadow uniforms
  const ud = renderer._shadowUniformData;
  ud.set(lightViewProj, 0);                     // lightViewProj (16 floats)
  const pf32 = new Float32Array(renderer._paramsData);
  const pu32 = new Uint32Array(renderer._paramsData);
  ud[16] = pf32[0];                             // defaultSize
  const udU32 = new Uint32Array(ud.buffer);
  udU32[17] = pu32[1];                          // alignMode
  ud[18] = 0;                                   // _pad0
  ud[19] = 0;                                   // _pad1
  renderer.device.queue.writeBuffer(renderer.shadowUniformBuffer, 0, ud);

  pass.setPipeline(renderer.shadowPipeline);
  pass.setBindGroup(0, renderer.shadowBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);

  const mesh = renderer.mesh;
  pass.setVertexBuffer(0, mesh.vertexBuffer);

  const indexFormat = mesh.indexFormat || 'uint32';
  if (mesh.indexBuffer) {
    pass.setIndexBuffer(mesh.indexBuffer, indexFormat);
    pass.drawIndexed(mesh.indexCount, instanceCount);
  } else {
    pass.draw(mesh.vertexCount, instanceCount);
  }
}

/**
 * Destroy the renderer.
 */
export function destroyParticleMeshRenderer(renderer) {
  if (!renderer) return;
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.meshParamsBuffer) renderer.meshParamsBuffer.destroy();
  if (renderer.shadowUniformBuffer) renderer.shadowUniformBuffer.destroy();
  renderer.frameBindGroup = null;
  renderer.dataBindGroup = null;
  renderer.shadowBindGroup = null;
  renderer.shadowDataBindGroup = null;
  renderer.shadowPipeline = null;
  renderer.mesh = null;
}
