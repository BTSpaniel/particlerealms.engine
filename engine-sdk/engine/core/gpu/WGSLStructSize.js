// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WGSLStructSize.js - Dynamic WGSL Struct Size Calculator
 * 
 * Parses WGSL struct definitions and calculates the correct buffer size
 * with proper alignment, preventing buffer size mismatch errors.
 * 
 * Usage:
 *   const size = calcWGSLStructSize(structCode);
 *   const buffer = device.createBuffer({ size, ... });
 * 
 * Or use the helper to create a correctly-sized buffer:
 *   const buffer = createUniformBuffer(device, structCode, 'My Buffer');
 */

// WGSL type sizes and alignments (in bytes)
// Reference: https://www.w3.org/TR/WGSL/#alignment-and-size
const WGSL_TYPES = {
    // Scalars
    'f32': { size: 4, align: 4 },
    'i32': { size: 4, align: 4 },
    'u32': { size: 4, align: 4 },
    'f16': { size: 2, align: 2 },
    'bool': { size: 4, align: 4 },  // Actually 1 byte but aligns to 4
    
    // Vectors
    'vec2<f32>': { size: 8, align: 8 },
    'vec2<i32>': { size: 8, align: 8 },
    'vec2<u32>': { size: 8, align: 8 },
    'vec2f': { size: 8, align: 8 },
    'vec2i': { size: 8, align: 8 },
    'vec2u': { size: 8, align: 8 },
    
    'vec3<f32>': { size: 12, align: 16 },  // Note: align 16!
    'vec3<i32>': { size: 12, align: 16 },
    'vec3<u32>': { size: 12, align: 16 },
    'vec3f': { size: 12, align: 16 },
    'vec3i': { size: 12, align: 16 },
    'vec3u': { size: 12, align: 16 },
    
    'vec4<f32>': { size: 16, align: 16 },
    'vec4<i32>': { size: 16, align: 16 },
    'vec4<u32>': { size: 16, align: 16 },
    'vec4f': { size: 16, align: 16 },
    'vec4i': { size: 16, align: 16 },
    'vec4u': { size: 16, align: 16 },
    
    // Matrices (column-major, each column is a vec)
    'mat2x2<f32>': { size: 16, align: 8 },
    'mat2x2f': { size: 16, align: 8 },
    'mat3x3<f32>': { size: 48, align: 16 },  // 3 vec3 columns, each padded to 16
    'mat3x3f': { size: 48, align: 16 },
    'mat4x4<f32>': { size: 64, align: 16 },
    'mat4x4f': { size: 64, align: 16 },
    
    // Shorthand
    'mat2x2': { size: 16, align: 8 },
    'mat3x3': { size: 48, align: 16 },
    'mat4x4': { size: 64, align: 16 },
};

/**
 * Parse a WGSL struct definition and extract field types
 * @param {string} structCode - WGSL struct definition
 * @returns {Array<{name: string, type: string}>} - Array of field definitions
 */
function parseStructFields(structCode) {
    const fields = [];
    
    // Match field definitions: name: type,
    // Handles optional trailing comma and various whitespace
    const fieldRegex = /(\w+)\s*:\s*([^,}\n]+)/g;
    let match;
    
    while ((match = fieldRegex.exec(structCode)) !== null) {
        const name = match[1].trim();
        let type = match[2].trim();
        
        // Remove trailing comma if present
        type = type.replace(/,\s*$/, '').trim();
        
        // Skip if it looks like a comment
        if (name.startsWith('//') || type.startsWith('//')) continue;
        
        fields.push({ name, type });
    }
    
    return fields;
}

/**
 * Get size and alignment for a WGSL type
 * @param {string} type - WGSL type name
 * @returns {{size: number, align: number}}
 */
function getTypeInfo(type) {
    // Normalize type (remove spaces, lowercase)
    const normalized = type.replace(/\s+/g, '').toLowerCase();
    
    // Check direct match
    if (WGSL_TYPES[normalized]) {
        return WGSL_TYPES[normalized];
    }
    
    // Check with original casing (for mat4x4<f32> etc)
    if (WGSL_TYPES[type]) {
        return WGSL_TYPES[type];
    }
    
    // Check case-insensitive
    for (const [key, value] of Object.entries(WGSL_TYPES)) {
        if (key.toLowerCase() === normalized) {
            return value;
        }
    }
    
    // Default to f32 if unknown (with warning)
    console.warn(`[WGSLStructSize] Unknown type "${type}", assuming f32`);
    return { size: 4, align: 4 };
}

/**
 * Align an offset to the specified alignment
 * @param {number} offset - Current offset
 * @param {number} align - Required alignment
 * @returns {number} - Aligned offset
 */
function alignTo(offset, align) {
    return Math.ceil(offset / align) * align;
}

/**
 * Calculate the total size of a WGSL struct with proper alignment
 * @param {string} structCode - WGSL struct definition
 * @returns {number} - Total size in bytes (aligned to 16 for uniform buffers)
 */
export function calcWGSLStructSize(structCode) {
    const fields = parseStructFields(structCode);
    
    if (fields.length === 0) {
        console.warn('[WGSLStructSize] No fields found in struct');
        return 16;  // Minimum uniform buffer size
    }
    
    let offset = 0;
    let maxAlign = 4;  // Track max alignment for struct padding
    
    for (const field of fields) {
        const info = getTypeInfo(field.type);
        
        // Align offset to field's alignment
        offset = alignTo(offset, info.align);
        
        // Add field size
        offset += info.size;
        
        // Track max alignment
        maxAlign = Math.max(maxAlign, info.align);
    }
    
    // Struct size must be aligned to max alignment of its members
    // For uniform buffers, also align to 16 bytes
    const structAlign = Math.max(maxAlign, 16);
    offset = alignTo(offset, structAlign);
    
    return offset;
}

/**
 * Create a uniform buffer with automatically calculated size
 * @param {GPUDevice} device - WebGPU device
 * @param {string} structCode - WGSL struct definition
 * @param {string} label - Buffer label for debugging
 * @returns {GPUBuffer} - Correctly sized uniform buffer
 */
export function createUniformBuffer(device, structCode, label = 'Uniform Buffer') {
    const size = calcWGSLStructSize(structCode);
    
    console.log(`[WGSLStructSize] ${label}: ${size} bytes`);
    
    return device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Create a storage buffer with automatically calculated size
 * @param {GPUDevice} device - WebGPU device
 * @param {string} structCode - WGSL struct definition
 * @param {number} count - Number of struct instances
 * @param {string} label - Buffer label for debugging
 * @returns {GPUBuffer} - Correctly sized storage buffer
 */
export function createStorageBuffer(device, structCode, count = 1, label = 'Storage Buffer') {
    const stride = calcWGSLStructSize(structCode);
    const size = stride * count;
    
    console.log(`[WGSLStructSize] ${label}: ${count} × ${stride} = ${size} bytes`);
    
    return device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Get the Float32Array size needed to fill a struct buffer
 * @param {string} structCode - WGSL struct definition
 * @returns {number} - Number of f32 elements needed
 */
export function getFloat32ArraySize(structCode) {
    return calcWGSLStructSize(structCode) / 4;
}

/**
 * Validate a buffer size against a struct definition
 * @param {number} bufferSize - Current buffer size
 * @param {string} structCode - WGSL struct definition
 * @param {string} label - Optional label for error message
 * @returns {{valid: boolean, required: number, message: string}}
 */
export function validateBufferSize(bufferSize, structCode, label = '') {
    const required = calcWGSLStructSize(structCode);
    const valid = bufferSize >= required;
    
    const message = valid
        ? `${label}: Buffer size OK (${bufferSize} >= ${required})`
        : `${label}: Buffer too small! ${bufferSize} < ${required} bytes required`;
    
    if (!valid) {
        console.error(`[WGSLStructSize] ${message}`);
    }
    
    return { valid, required, message };
}

// Export all utilities
export default {
    calcWGSLStructSize,
    createUniformBuffer,
    createStorageBuffer,
    getFloat32ArraySize,
    validateBufferSize,
    parseStructFields,
    getTypeInfo,
    WGSL_TYPES,
};
