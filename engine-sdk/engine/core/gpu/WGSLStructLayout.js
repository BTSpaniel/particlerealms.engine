// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WGSLStructLayout.js - Unified WGSL/JS Struct Layout Generator
 * 
 * Parses WGSL struct definitions and generates:
 * - Correct buffer sizes with WebGPU alignment
 * - JS field offset maps for TypedArray access
 * - Accessor helper classes for reading/writing struct data
 * 
 * This ensures WGSL and JS stay perfectly in sync - define once in WGSL,
 * use the generated layout in JS.
 * 
 * Usage:
 *   const layout = parseWGSLStruct(`
 *     struct Params {
 *       dt: f32,
 *       particleCount: u32,
 *       roomHalfSize: f32,
 *       gravityY: f32,
 *     }
 *   `);
 *   
 *   // layout.size = 16 (bytes)
 *   // layout.fields = { dt: {offset: 0, size: 4}, particleCount: {offset: 4, size: 4}, ... }
 *   
 *   const accessor = createStructAccessor(layout);
 *   const data = new Float32Array(layout.size / 4);
 *   accessor.set(data, 'dt', 0.016);
 *   accessor.set(data, 'particleCount', 1000); // auto-converts to u32
 */

// WGSL type info: { size, align, jsType, arrayType }
const WGSL_TYPE_INFO = {
  // Scalars
  'f32':    { size: 4,  align: 4,  jsType: 'f32', arrayType: Float32Array },
  'i32':    { size: 4,  align: 4,  jsType: 'i32', arrayType: Int32Array },
  'u32':    { size: 4,  align: 4,  jsType: 'u32', arrayType: Uint32Array },
  'f16':    { size: 2,  align: 2,  jsType: 'f16', arrayType: Uint16Array },
  'bool':   { size: 4,  align: 4,  jsType: 'u32', arrayType: Uint32Array },
  
  // vec2
  'vec2<f32>': { size: 8,  align: 8,  jsType: 'vec2f', arrayType: Float32Array, components: 2 },
  'vec2<i32>': { size: 8,  align: 8,  jsType: 'vec2i', arrayType: Int32Array, components: 2 },
  'vec2<u32>': { size: 8,  align: 8,  jsType: 'vec2u', arrayType: Uint32Array, components: 2 },
  'vec2f':     { size: 8,  align: 8,  jsType: 'vec2f', arrayType: Float32Array, components: 2 },
  'vec2i':     { size: 8,  align: 8,  jsType: 'vec2i', arrayType: Int32Array, components: 2 },
  'vec2u':     { size: 8,  align: 8,  jsType: 'vec2u', arrayType: Uint32Array, components: 2 },
  
  // vec3 (align 16!)
  'vec3<f32>': { size: 12, align: 16, jsType: 'vec3f', arrayType: Float32Array, components: 3 },
  'vec3<i32>': { size: 12, align: 16, jsType: 'vec3i', arrayType: Int32Array, components: 3 },
  'vec3<u32>': { size: 12, align: 16, jsType: 'vec3u', arrayType: Uint32Array, components: 3 },
  'vec3f':     { size: 12, align: 16, jsType: 'vec3f', arrayType: Float32Array, components: 3 },
  'vec3i':     { size: 12, align: 16, jsType: 'vec3i', arrayType: Int32Array, components: 3 },
  'vec3u':     { size: 12, align: 16, jsType: 'vec3u', arrayType: Uint32Array, components: 3 },
  
  // vec4
  'vec4<f32>': { size: 16, align: 16, jsType: 'vec4f', arrayType: Float32Array, components: 4 },
  'vec4<i32>': { size: 16, align: 16, jsType: 'vec4i', arrayType: Int32Array, components: 4 },
  'vec4<u32>': { size: 16, align: 16, jsType: 'vec4u', arrayType: Uint32Array, components: 4 },
  'vec4f':     { size: 16, align: 16, jsType: 'vec4f', arrayType: Float32Array, components: 4 },
  'vec4i':     { size: 16, align: 16, jsType: 'vec4i', arrayType: Int32Array, components: 4 },
  'vec4u':     { size: 16, align: 16, jsType: 'vec4u', arrayType: Uint32Array, components: 4 },
  
  // Matrices (column-major)
  'mat2x2<f32>': { size: 16, align: 8,  jsType: 'mat2x2f', arrayType: Float32Array, components: 4 },
  'mat2x2f':     { size: 16, align: 8,  jsType: 'mat2x2f', arrayType: Float32Array, components: 4 },
  'mat3x3<f32>': { size: 48, align: 16, jsType: 'mat3x3f', arrayType: Float32Array, components: 12 },
  'mat3x3f':     { size: 48, align: 16, jsType: 'mat3x3f', arrayType: Float32Array, components: 12 },
  'mat4x4<f32>': { size: 64, align: 16, jsType: 'mat4x4f', arrayType: Float32Array, components: 16 },
  'mat4x4f':     { size: 64, align: 16, jsType: 'mat4x4f', arrayType: Float32Array, components: 16 },
  
  // Atomics
  'atomic<i32>': { size: 4, align: 4, jsType: 'i32', arrayType: Int32Array },
  'atomic<u32>': { size: 4, align: 4, jsType: 'u32', arrayType: Uint32Array },
};

function alignTo(offset, align) {
  return Math.ceil(offset / align) * align;
}

function normalizeType(type) {
  return type.replace(/\s+/g, '').toLowerCase();
}

function getTypeInfo(type) {
  const normalized = normalizeType(type);
  if (WGSL_TYPE_INFO[normalized]) {
    return WGSL_TYPE_INFO[normalized];
  }
  if (WGSL_TYPE_INFO[type]) {
    return WGSL_TYPE_INFO[type];
  }
  for (const [key, value] of Object.entries(WGSL_TYPE_INFO)) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }
  console.warn(`[WGSLStructLayout] Unknown type "${type}", assuming f32`);
  return { size: 4, align: 4, jsType: 'f32', arrayType: Float32Array };
}

/**
 * Parse a WGSL struct definition and compute field layout
 * @param {string} wgslCode - WGSL struct code
 * @returns {Object} Layout object with name, size, align, fields
 */
export function parseWGSLStruct(wgslCode) {
  // Extract struct name and body (only parse fields inside the first struct block)
  const structMatch = wgslCode.match(/struct\s+(\w+)\s*\{([^}]+)\}/);
  const name = structMatch ? structMatch[1] : 'Anonymous';
  const structBody = structMatch ? structMatch[2] : wgslCode;
  
  // Extract fields from struct body only
  const fieldRegex = /(\w+)\s*:\s*([^,}\n]+)/g;
  const fields = {};
  const fieldOrder = [];
  let match;
  
  while ((match = fieldRegex.exec(structBody)) !== null) {
    const fieldName = match[1].trim();
    let fieldType = match[2].trim().replace(/,\s*$/, '').trim();
    
    if (fieldName.startsWith('//') || fieldType.startsWith('//')) continue;
    
    fields[fieldName] = { type: fieldType };
    fieldOrder.push(fieldName);
  }
  
  // Compute offsets with proper alignment
  let offset = 0;
  let maxAlign = 4;
  
  for (const fieldName of fieldOrder) {
    const field = fields[fieldName];
    const typeInfo = getTypeInfo(field.type);
    
    // Align to field's alignment requirement
    offset = alignTo(offset, typeInfo.align);
    
    field.offset = offset;
    field.size = typeInfo.size;
    field.align = typeInfo.align;
    field.jsType = typeInfo.jsType;
    field.arrayType = typeInfo.arrayType;
    field.components = typeInfo.components || 1;
    field.byteOffset = offset;
    field.f32Offset = offset / 4;
    field.u32Offset = offset / 4;
    field.i32Offset = offset / 4;
    
    offset += typeInfo.size;
    maxAlign = Math.max(maxAlign, typeInfo.align);
  }
  
  // Struct size aligned to max member alignment (minimum 16 for uniform)
  const structAlign = Math.max(maxAlign, 16);
  const size = alignTo(offset, structAlign);
  
  return {
    name,
    size,
    align: structAlign,
    fields,
    fieldOrder,
    f32Count: size / 4,
    u32Count: size / 4,
  };
}

/**
 * Create an accessor object for reading/writing struct fields
 * @param {Object} layout - Layout from parseWGSLStruct
 * @returns {Object} Accessor with get/set methods
 */
export function createStructAccessor(layout) {
  const { fields, size } = layout;
  
  return {
    layout,
    size,
    
    /**
     * Set a field value in the buffer
     * @param {ArrayBuffer|TypedArray} buffer - Target buffer
     * @param {string} fieldName - Field name
     * @param {number|Array} value - Value to set
     * @param {number} structIndex - Index if buffer holds multiple structs
     */
    set(buffer, fieldName, value, structIndex = 0) {
      const field = fields[fieldName];
      if (!field) {
        console.warn(`[WGSLStructLayout] Unknown field: ${fieldName}`);
        return;
      }
      
      const baseOffset = structIndex * size;
      const byteOffset = baseOffset + field.byteOffset;
      
      let view;
      if (ArrayBuffer.isView(buffer)) {
        view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else {
        view = new DataView(buffer);
      }
      
      if (field.components === 1) {
        // Scalar
        if (field.jsType === 'f32') {
          view.setFloat32(byteOffset, value, true);
        } else if (field.jsType === 'i32') {
          view.setInt32(byteOffset, value | 0, true);
        } else if (field.jsType === 'u32') {
          view.setUint32(byteOffset, value >>> 0, true);
        }
      } else {
        // Vector/Matrix
        const arr = Array.isArray(value) ? value : [value];
        for (let i = 0; i < field.components && i < arr.length; i++) {
          const componentOffset = byteOffset + i * 4;
          if (field.jsType.includes('f')) {
            view.setFloat32(componentOffset, arr[i], true);
          } else if (field.jsType.includes('i')) {
            view.setInt32(componentOffset, arr[i] | 0, true);
          } else {
            view.setUint32(componentOffset, arr[i] >>> 0, true);
          }
        }
      }
    },
    
    /**
     * Get a field value from the buffer
     * @param {ArrayBuffer|TypedArray} buffer - Source buffer
     * @param {string} fieldName - Field name
     * @param {number} structIndex - Index if buffer holds multiple structs
     * @returns {number|Array} Field value
     */
    get(buffer, fieldName, structIndex = 0) {
      const field = fields[fieldName];
      if (!field) {
        console.warn(`[WGSLStructLayout] Unknown field: ${fieldName}`);
        return undefined;
      }
      
      const baseOffset = structIndex * size;
      const byteOffset = baseOffset + field.byteOffset;
      
      let view;
      if (ArrayBuffer.isView(buffer)) {
        view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else {
        view = new DataView(buffer);
      }
      
      if (field.components === 1) {
        if (field.jsType === 'f32') {
          return view.getFloat32(byteOffset, true);
        } else if (field.jsType === 'i32') {
          return view.getInt32(byteOffset, true);
        } else {
          return view.getUint32(byteOffset, true);
        }
      } else {
        const result = [];
        for (let i = 0; i < field.components; i++) {
          const componentOffset = byteOffset + i * 4;
          if (field.jsType.includes('f')) {
            result.push(view.getFloat32(componentOffset, true));
          } else if (field.jsType.includes('i')) {
            result.push(view.getInt32(componentOffset, true));
          } else {
            result.push(view.getUint32(componentOffset, true));
          }
        }
        return result;
      }
    },
    
    /**
     * Create a new ArrayBuffer for this struct (or array of structs)
     * @param {number} count - Number of structs
     * @returns {ArrayBuffer}
     */
    createBuffer(count = 1) {
      return new ArrayBuffer(size * count);
    },
    
    /**
     * Create typed array views for direct field access
     * @param {ArrayBuffer} buffer
     * @returns {Object} Object with f32, i32, u32 views
     */
    createViews(buffer) {
      return {
        f32: new Float32Array(buffer),
        i32: new Int32Array(buffer),
        u32: new Uint32Array(buffer),
      };
    },
  };
}

/**
 * Define a struct layout from WGSL and return both layout and accessor
 * @param {string} wgslCode - WGSL struct definition
 * @returns {{ layout: Object, accessor: Object, wgsl: string }}
 */
export function defineStruct(wgslCode) {
  const layout = parseWGSLStruct(wgslCode);
  const accessor = createStructAccessor(layout);
  return { layout, accessor, wgsl: wgslCode };
}

/**
 * Generate JS object literal layout definition from WGSL struct
 * Useful for documentation or code generation
 * @param {string} wgslCode
 * @returns {string} JS code
 */
export function generateJSLayout(wgslCode) {
  const layout = parseWGSLStruct(wgslCode);
  const lines = [`// Generated from WGSL struct ${layout.name}`, `const ${layout.name}Layout = {`];
  lines.push(`  size: ${layout.size},`);
  lines.push(`  align: ${layout.align},`);
  lines.push(`  fields: {`);
  
  for (const fieldName of layout.fieldOrder) {
    const f = layout.fields[fieldName];
    lines.push(`    ${fieldName}: { offset: ${f.offset}, size: ${f.size}, type: '${f.jsType}' },`);
  }
  
  lines.push(`  },`);
  lines.push(`};`);
  return lines.join('\n');
}

/**
 * Validate that a buffer matches the expected struct layout
 * @param {GPUBuffer|ArrayBuffer|TypedArray} buffer
 * @param {Object} layout
 * @param {number} expectedCount - Expected number of structs
 * @returns {{ valid: boolean, message: string }}
 */
export function validateBuffer(buffer, layout, expectedCount = 1) {
  let byteLength;
  if (buffer.size !== undefined) {
    byteLength = buffer.size; // GPUBuffer
  } else if (buffer.byteLength !== undefined) {
    byteLength = buffer.byteLength;
  } else {
    return { valid: false, message: 'Cannot determine buffer size' };
  }
  
  const required = layout.size * expectedCount;
  if (byteLength < required) {
    return {
      valid: false,
      message: `Buffer too small: ${byteLength} bytes < ${required} required (${expectedCount} x ${layout.size})`,
    };
  }
  
  return { valid: true, message: `Buffer OK: ${byteLength} bytes >= ${required} required` };
}

// Pre-defined common struct layouts
export const CommonStructs = {
  Params: defineStruct(`
    struct Params {
      dt: f32,
      particleCount: u32,
      roomHalfSize: f32,
      gravityY: f32,
      baseIndex: u32,
      _pad0: u32,
      _pad1: u32,
      _pad2: u32,
    }
  `),
  
  FluidParams: defineStruct(`
    struct FluidParams {
      gridSize: vec3<f32>,
      fluidEnabled: f32,
      worldMin: vec3<f32>,
      _pad0: f32,
      worldMax: vec3<f32>,
      fluidInfluence: f32,
    }
  `),
  
  Transform: defineStruct(`
    struct Transform {
      model: mat4x4<f32>,
    }
  `),
  
  Camera: defineStruct(`
    struct Camera {
      view: mat4x4<f32>,
      projection: mat4x4<f32>,
      viewProjection: mat4x4<f32>,
      position: vec3<f32>,
      _pad: f32,
    }
  `),

  ForceParams: defineStruct(`
    struct ForceParams {
      windDir: vec3<f32>,
      windStrength: f32,
      gustPhase: f32,
      gustStrength: f32,
      turbulenceStrength: f32,
      turbulenceScale: f32,
      turbulenceSpeed: f32,
      turbulenceOctaves: u32,
      forcePointCount: u32,
      maxVelocity: f32,
      vortexPos: vec3<f32>,
      vortexStrength: f32,
      vortexAxis: vec3<f32>,
      vortexRadius: f32,
      sizeGravityScale: f32,
      sortFrameInterval: u32,
      _fpPad0: u32,
      _fpPad1: u32,
    }
  `),
};

export default {
  parseWGSLStruct,
  createStructAccessor,
  defineStruct,
  generateJSLayout,
  validateBuffer,
  CommonStructs,
  WGSL_TYPE_INFO,
};
