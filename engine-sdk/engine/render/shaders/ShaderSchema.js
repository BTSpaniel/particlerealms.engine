// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShaderSchema.js - Unified JSON Schema for Shader Uniforms and Buffers
 * 
 * Defines consistent data structures for:
 * - Uniform buffer layouts with byte offsets
 * - Binding group configurations
 * - Common struct definitions
 * - WGSL code generation helpers
 * 
 * All shader code should use these schemas for consistency.
 */

// ============================================================================
// WGSL TYPE DEFINITIONS
// ============================================================================

/**
 * WGSL type sizes in bytes (aligned to 16-byte boundaries for uniforms)
 */
export const WGSL_TYPES = {
  f32: { size: 4, align: 4, wgsl: "f32" },
  i32: { size: 4, align: 4, wgsl: "i32" },
  u32: { size: 4, align: 4, wgsl: "u32" },
  vec2f: { size: 8, align: 8, wgsl: "vec2<f32>" },
  vec2i: { size: 8, align: 8, wgsl: "vec2<i32>" },
  vec2u: { size: 8, align: 8, wgsl: "vec2<u32>" },
  vec3f: { size: 12, align: 16, wgsl: "vec3<f32>" },
  vec3i: { size: 12, align: 16, wgsl: "vec3<i32>" },
  vec3u: { size: 12, align: 16, wgsl: "vec3<u32>" },
  vec4f: { size: 16, align: 16, wgsl: "vec4<f32>" },
  vec4i: { size: 16, align: 16, wgsl: "vec4<i32>" },
  vec4u: { size: 16, align: 16, wgsl: "vec4<u32>" },
  mat3x3f: { size: 48, align: 16, wgsl: "mat3x3<f32>" },
  mat4x4f: { size: 64, align: 16, wgsl: "mat4x4<f32>" },
};

/**
 * Buffer usage types
 */
export const BUFFER_USAGE = {
  uniform: "uniform",
  storage: "storage, read",
  storageRW: "storage, read_write",
};

/**
 * Texture types
 */
export const TEXTURE_TYPES = {
  texture2d: "texture_2d<f32>",
  texture2dArray: "texture_2d_array<f32>",
  textureCube: "texture_cube<f32>",
  textureDepth: "texture_depth_2d",
  textureStorage: "texture_storage_2d<rgba8unorm, write>",
};

// ============================================================================
// COMMON UNIFORM STRUCTS
// ============================================================================

/**
 * Frame uniforms - camera and time data, updated every frame
 */
export const FRAME_UNIFORMS_SCHEMA = {
  name: "FrameUniforms",
  size: 256,
  fields: [
    { name: "viewProj", type: "mat4x4f", offset: 0, desc: "View * Projection matrix" },
    { name: "view", type: "mat4x4f", offset: 64, desc: "View matrix" },
    { name: "projection", type: "mat4x4f", offset: 128, desc: "Projection matrix" },
    { name: "cameraPos", type: "vec3f", offset: 192, desc: "Camera world position" },
    { name: "time", type: "f32", offset: 204, desc: "Total elapsed time" },
    { name: "viewRight", type: "vec3f", offset: 208, desc: "Camera right vector" },
    { name: "deltaTime", type: "f32", offset: 220, desc: "Frame delta time" },
    { name: "viewUp", type: "vec3f", offset: 224, desc: "Camera up vector" },
    { name: "frameIndex", type: "u32", offset: 236, desc: "Frame counter" },
    { name: "resolution", type: "vec2f", offset: 240, desc: "Render resolution" },
    { name: "_pad", type: "vec2f", offset: 248, desc: "Padding" },
  ],
};

/**
 * Model uniforms - per-object transform data
 */
export const MODEL_UNIFORMS_SCHEMA = {
  name: "ModelUniforms",
  size: 144,
  fields: [
    { name: "model", type: "mat4x4f", offset: 0, desc: "Model matrix" },
    { name: "normalMatrix", type: "mat4x4f", offset: 64, desc: "Normal matrix (inverse transpose)" },
    { name: "tintColor", type: "vec4f", offset: 128, desc: "Color tint RGBA" },
  ],
};

/**
 * Light struct for dynamic lighting
 */
export const LIGHT_STRUCT_SCHEMA = {
  name: "Light",
  size: 48,
  fields: [
    { name: "position", type: "vec3f", offset: 0, desc: "World position" },
    { name: "lightType", type: "u32", offset: 12, desc: "0=point, 1=directional, 2=spot" },
    { name: "color", type: "vec3f", offset: 16, desc: "RGB intensity" },
    { name: "innerCone", type: "f32", offset: 28, desc: "Spot inner cone cosine" },
    { name: "direction", type: "vec3f", offset: 32, desc: "Light direction" },
    { name: "outerCone", type: "f32", offset: 44, desc: "Spot outer cone cosine" },
  ],
};

/**
 * PBR material uniforms
 */
export const MATERIAL_UNIFORMS_SCHEMA = {
  name: "MaterialUniforms",
  size: 32,
  fields: [
    { name: "baseColorFactor", type: "vec4f", offset: 0, desc: "Base color RGBA" },
    { name: "emissiveFactor", type: "vec3f", offset: 16, desc: "Emissive RGB" },
    { name: "metallicFactor", type: "f32", offset: 28, desc: "Metallic 0-1" },
    { name: "roughnessFactor", type: "f32", offset: 32, desc: "Roughness 0-1" },
  ],
};

/**
 * Particle render params
 */
export const PARTICLE_PARAMS_SCHEMA = {
  name: "ParticleParams",
  size: 32,
  fields: [
    { name: "defaultSize", type: "f32", offset: 0, desc: "Fallback particle size" },
    { name: "quality", type: "f32", offset: 4, desc: "Render quality 0-1" },
    { name: "lodBias", type: "f32", offset: 8, desc: "LOD distance bias" },
    { name: "cullThreshold", type: "f32", offset: 12, desc: "Max instance to render" },
    { name: "time", type: "f32", offset: 16, desc: "Simulation time" },
    { name: "deltaTime", type: "f32", offset: 20, desc: "Frame delta" },
    { name: "_pad", type: "vec2f", offset: 24, desc: "Padding" },
  ],
};

/**
 * Post-process common params
 */
export const POSTFX_PARAMS_SCHEMA = {
  name: "PostFXParams",
  size: 32,
  fields: [
    { name: "resolution", type: "vec2f", offset: 0, desc: "Render resolution" },
    { name: "invResolution", type: "vec2f", offset: 8, desc: "1/resolution" },
    { name: "time", type: "f32", offset: 16, desc: "Elapsed time" },
    { name: "intensity", type: "f32", offset: 20, desc: "Effect intensity" },
    { name: "_pad", type: "vec2f", offset: 24, desc: "Padding" },
  ],
};

// ============================================================================
// BINDING GROUP SCHEMAS
// ============================================================================

/**
 * Standard binding group layouts
 */
export const BINDING_GROUPS = {
  frame: {
    group: 0,
    desc: "Frame-level uniforms (camera, time)",
    bindings: [
      { binding: 0, name: "uFrame", type: "uniform", schema: "FRAME_UNIFORMS_SCHEMA" },
    ],
  },
  model: {
    group: 1,
    desc: "Per-object uniforms (transform)",
    bindings: [
      { binding: 0, name: "uModel", type: "uniform", schema: "MODEL_UNIFORMS_SCHEMA" },
    ],
  },
  material: {
    group: 2,
    desc: "Material properties",
    bindings: [
      { binding: 0, name: "uMaterial", type: "uniform", schema: "MATERIAL_UNIFORMS_SCHEMA" },
      { binding: 1, name: "uAlbedoTex", type: "texture2d" },
      { binding: 2, name: "uAlbedoSampler", type: "sampler" },
      { binding: 3, name: "uNormalTex", type: "texture2d" },
      { binding: 4, name: "uNormalSampler", type: "sampler" },
    ],
  },
  lighting: {
    group: 3,
    desc: "Lighting data",
    bindings: [
      { binding: 0, name: "uLights", type: "storage", schema: "LIGHT_STRUCT_SCHEMA", array: 64 },
      { binding: 1, name: "uShadowMap", type: "textureDepth" },
      { binding: 2, name: "uShadowSampler", type: "samplerComparison" },
    ],
  },
  particles: {
    group: 1,
    desc: "Particle system buffers",
    bindings: [
      { binding: 0, name: "uPositions", type: "storage", elementType: "vec4f", desc: "xyz=pos, w=age" },
      { binding: 1, name: "uMeta", type: "storage", elementType: "vec4f", desc: "rgb=color, w=packed" },
      { binding: 2, name: "uParams", type: "uniform", schema: "PARTICLE_PARAMS_SCHEMA" },
      { binding: 3, name: "uVelocities", type: "storage", elementType: "vec4f", desc: "xyz=vel, w=lifetime" },
      { binding: 4, name: "uUVs", type: "storage", elementType: "vec4f", desc: "xy=uv, z=opacity" },
      { binding: 5, name: "uAlbedoTex", type: "texture2d" },
      { binding: 6, name: "uAlbedoSampler", type: "sampler" },
    ],
  },
  postfx: {
    group: 0,
    desc: "Post-processing pass",
    bindings: [
      { binding: 0, name: "uParams", type: "uniform", schema: "POSTFX_PARAMS_SCHEMA" },
      { binding: 1, name: "uInputTex", type: "texture2d" },
      { binding: 2, name: "uInputSampler", type: "sampler" },
      { binding: 3, name: "uDepthTex", type: "textureDepth" },
    ],
  },
};

// ============================================================================
// VERTEX ATTRIBUTE SCHEMAS
// ============================================================================

/**
 * Standard vertex layouts
 */
export const VERTEX_LAYOUTS = {
  position: {
    attributes: [
      { name: "position", location: 0, type: "vec3f", offset: 0 },
    ],
    stride: 12,
  },
  positionNormal: {
    attributes: [
      { name: "position", location: 0, type: "vec3f", offset: 0 },
      { name: "normal", location: 1, type: "vec3f", offset: 12 },
    ],
    stride: 24,
  },
  positionNormalUV: {
    attributes: [
      { name: "position", location: 0, type: "vec3f", offset: 0 },
      { name: "normal", location: 1, type: "vec3f", offset: 12 },
      { name: "uv", location: 2, type: "vec2f", offset: 24 },
    ],
    stride: 32,
  },
  positionNormalUVTangent: {
    attributes: [
      { name: "position", location: 0, type: "vec3f", offset: 0 },
      { name: "normal", location: 1, type: "vec3f", offset: 12 },
      { name: "uv", location: 2, type: "vec2f", offset: 24 },
      { name: "tangent", location: 3, type: "vec4f", offset: 32 },
    ],
    stride: 48,
  },
  skinned: {
    attributes: [
      { name: "position", location: 0, type: "vec3f", offset: 0 },
      { name: "normal", location: 1, type: "vec3f", offset: 12 },
      { name: "uv", location: 2, type: "vec2f", offset: 24 },
      { name: "joints", location: 3, type: "vec4u", offset: 32 },
      { name: "weights", location: 4, type: "vec4f", offset: 48 },
    ],
    stride: 64,
  },
};

// ============================================================================
// ALL SCHEMAS
// ============================================================================

export const UNIFORM_SCHEMAS = {
  FrameUniforms: FRAME_UNIFORMS_SCHEMA,
  ModelUniforms: MODEL_UNIFORMS_SCHEMA,
  MaterialUniforms: MATERIAL_UNIFORMS_SCHEMA,
  ParticleParams: PARTICLE_PARAMS_SCHEMA,
  PostFXParams: POSTFX_PARAMS_SCHEMA,
  Light: LIGHT_STRUCT_SCHEMA,
};

// ============================================================================
// WGSL CODE GENERATION
// ============================================================================

/**
 * Generate WGSL struct definition from schema
 */
export function generateStructWGSL(schema) {
  let wgsl = `struct ${schema.name} {\n`;
  for (const field of schema.fields) {
    const type = WGSL_TYPES[field.type];
    if (!type) {
      console.warn(`Unknown type: ${field.type}`);
      continue;
    }
    wgsl += `  ${field.name} : ${type.wgsl},\n`;
  }
  wgsl += `};\n`;
  return wgsl;
}

/**
 * Generate WGSL binding declarations from binding group schema
 */
export function generateBindingsWGSL(groupSchema) {
  let wgsl = "";
  for (const binding of groupSchema.bindings) {
    const group = groupSchema.group;
    const bind = binding.binding;
    
    if (binding.type === "uniform") {
      const schema = UNIFORM_SCHEMAS[binding.schema?.replace("_SCHEMA", "")];
      if (schema) {
        wgsl += `@group(${group}) @binding(${bind}) var<uniform> ${binding.name} : ${schema.name};\n`;
      }
    } else if (binding.type === "storage") {
      const elemType = binding.elementType ? WGSL_TYPES[binding.elementType]?.wgsl : "vec4<f32>";
      if (binding.array) {
        wgsl += `@group(${group}) @binding(${bind}) var<storage, read> ${binding.name} : array<${elemType}, ${binding.array}>;\n`;
      } else {
        wgsl += `@group(${group}) @binding(${bind}) var<storage, read> ${binding.name} : array<${elemType}>;\n`;
      }
    } else if (binding.type === "texture2d") {
      wgsl += `@group(${group}) @binding(${bind}) var ${binding.name} : texture_2d<f32>;\n`;
    } else if (binding.type === "textureDepth") {
      wgsl += `@group(${group}) @binding(${bind}) var ${binding.name} : texture_depth_2d;\n`;
    } else if (binding.type === "sampler") {
      wgsl += `@group(${group}) @binding(${bind}) var ${binding.name} : sampler;\n`;
    } else if (binding.type === "samplerComparison") {
      wgsl += `@group(${group}) @binding(${bind}) var ${binding.name} : sampler_comparison;\n`;
    }
  }
  return wgsl;
}

/**
 * Generate WGSL vertex input struct from vertex layout
 */
export function generateVertexInputWGSL(layout) {
  let wgsl = "struct VertexInput {\n";
  for (const attr of layout.attributes) {
    const type = WGSL_TYPES[attr.type];
    wgsl += `  @location(${attr.location}) ${attr.name} : ${type.wgsl},\n`;
  }
  wgsl += "};\n";
  return wgsl;
}

// ============================================================================
// BUFFER HELPERS
// ============================================================================

/**
 * Calculate aligned byte offset for a field
 */
export function alignOffset(offset, alignment) {
  return Math.ceil(offset / alignment) * alignment;
}

/**
 * Calculate total buffer size from schema (with alignment)
 */
export function calculateBufferSize(schema) {
  let size = 0;
  for (const field of schema.fields) {
    const type = WGSL_TYPES[field.type];
    if (!type) continue;
    size = alignOffset(size, type.align);
    size += type.size;
  }
  return alignOffset(size, 16); // Final 16-byte alignment for uniform buffers
}

/**
 * Create a typed array buffer matching schema
 */
export function createUniformBuffer(schema) {
  const size = schema.size || calculateBufferSize(schema);
  return new ArrayBuffer(size);
}

/**
 * Write a value to a uniform buffer at the field's offset
 */
export function writeUniformField(buffer, schema, fieldName, value) {
  const field = schema.fields.find(f => f.name === fieldName);
  if (!field) {
    console.warn(`Unknown field: ${fieldName}`);
    return;
  }
  
  const view = new DataView(buffer);
  const type = WGSL_TYPES[field.type];
  const offset = field.offset;
  
  if (type.wgsl === "f32") {
    view.setFloat32(offset, value, true);
  } else if (type.wgsl === "u32") {
    view.setUint32(offset, value, true);
  } else if (type.wgsl === "i32") {
    view.setInt32(offset, value, true);
  } else if (type.wgsl.startsWith("vec")) {
    const f32 = new Float32Array(buffer, offset, type.size / 4);
    for (let i = 0; i < value.length && i < f32.length; i++) {
      f32[i] = value[i];
    }
  } else if (type.wgsl.startsWith("mat")) {
    const f32 = new Float32Array(buffer, offset, type.size / 4);
    for (let i = 0; i < value.length && i < f32.length; i++) {
      f32[i] = value[i];
    }
  }
}

/**
 * Read a value from a uniform buffer at the field's offset
 */
export function readUniformField(buffer, schema, fieldName) {
  const field = schema.fields.find(f => f.name === fieldName);
  if (!field) return undefined;
  
  const view = new DataView(buffer);
  const type = WGSL_TYPES[field.type];
  const offset = field.offset;
  
  if (type.wgsl === "f32") {
    return view.getFloat32(offset, true);
  } else if (type.wgsl === "u32") {
    return view.getUint32(offset, true);
  } else if (type.wgsl === "i32") {
    return view.getInt32(offset, true);
  } else if (type.wgsl.startsWith("vec") || type.wgsl.startsWith("mat")) {
    return Array.from(new Float32Array(buffer, offset, type.size / 4));
  }
  return undefined;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a uniform buffer against schema
 */
export function validateUniformBuffer(buffer, schema) {
  const errors = [];
  
  if (buffer.byteLength < schema.size) {
    errors.push(`Buffer too small: ${buffer.byteLength} < ${schema.size}`);
  }
  
  for (const field of schema.fields) {
    const value = readUniformField(buffer, schema, field.name);
    if (value === undefined) {
      errors.push(`Failed to read field: ${field.name}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate binding group layout
 */
export function validateBindingGroup(entries, groupSchema) {
  const errors = [];
  
  for (const binding of groupSchema.bindings) {
    const entry = entries.find(e => e.binding === binding.binding);
    if (!entry) {
      errors.push(`Missing binding ${binding.binding}: ${binding.name}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create frame uniforms buffer with defaults
 */
export function createFrameUniformsBuffer() {
  const buffer = createUniformBuffer(FRAME_UNIFORMS_SCHEMA);
  // Set identity matrices as defaults
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "viewProj", identity);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "view", identity);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "projection", identity);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "cameraPos", [0, 0, 0]);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "viewRight", [1, 0, 0]);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "viewUp", [0, 1, 0]);
  writeUniformField(buffer, FRAME_UNIFORMS_SCHEMA, "resolution", [1920, 1080]);
  return buffer;
}

/**
 * Create model uniforms buffer with defaults
 */
export function createModelUniformsBuffer() {
  const buffer = createUniformBuffer(MODEL_UNIFORMS_SCHEMA);
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  writeUniformField(buffer, MODEL_UNIFORMS_SCHEMA, "model", identity);
  writeUniformField(buffer, MODEL_UNIFORMS_SCHEMA, "normalMatrix", identity);
  writeUniformField(buffer, MODEL_UNIFORMS_SCHEMA, "tintColor", [1, 1, 1, 1]);
  return buffer;
}

/**
 * Create material uniforms buffer with defaults
 */
export function createMaterialUniformsBuffer() {
  const buffer = createUniformBuffer(MATERIAL_UNIFORMS_SCHEMA);
  writeUniformField(buffer, MATERIAL_UNIFORMS_SCHEMA, "baseColorFactor", [1, 1, 1, 1]);
  writeUniformField(buffer, MATERIAL_UNIFORMS_SCHEMA, "emissiveFactor", [0, 0, 0]);
  writeUniformField(buffer, MATERIAL_UNIFORMS_SCHEMA, "metallicFactor", 0);
  writeUniformField(buffer, MATERIAL_UNIFORMS_SCHEMA, "roughnessFactor", 0.5);
  return buffer;
}

/**
 * Create particle params buffer with defaults
 */
export function createParticleParamsBuffer() {
  const buffer = createUniformBuffer(PARTICLE_PARAMS_SCHEMA);
  writeUniformField(buffer, PARTICLE_PARAMS_SCHEMA, "defaultSize", 2.0);
  writeUniformField(buffer, PARTICLE_PARAMS_SCHEMA, "quality", 1.0);
  writeUniformField(buffer, PARTICLE_PARAMS_SCHEMA, "lodBias", 1.0);
  writeUniformField(buffer, PARTICLE_PARAMS_SCHEMA, "cullThreshold", 0);
  return buffer;
}

// ============================================================================
// PREBUILT WGSL SNIPPETS
// ============================================================================

/**
 * Common WGSL utility functions
 */
export const COMMON_WGSL = /* wgsl */`
fn saturate(x: f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn saturate3(v: vec3<f32>) -> vec3<f32> {
  return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linearToSRGB(color: vec3<f32>) -> vec3<f32> {
  let cutoff = color < vec3<f32>(0.0031308);
  let higher = vec3<f32>(1.055) * pow(color, vec3<f32>(1.0/2.4)) - vec3<f32>(0.055);
  let lower = color * vec3<f32>(12.92);
  return select(higher, lower, cutoff);
}

fn sRGBToLinear(color: vec3<f32>) -> vec3<f32> {
  let cutoff = color < vec3<f32>(0.04045);
  let higher = pow((color + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
  let lower = color / vec3<f32>(12.92);
  return select(higher, lower, cutoff);
}

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}
`;

/**
 * Full-screen triangle vertex shader
 */
export const FULLSCREEN_TRIANGLE_VS = /* wgsl */`
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  out.uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.position = vec4<f32>(out.uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv.y = 1.0 - out.uv.y; // Flip Y for texture sampling
  return out;
}
`;
