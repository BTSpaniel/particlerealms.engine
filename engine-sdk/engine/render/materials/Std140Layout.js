// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Std140Layout.js - WebGPU std140 Uniform Buffer Layout System
 * 
 * Implements strict std140 alignment rules for CPU-GPU data transfer.
 * Prevents the infamous "vec3 trap" and other alignment pitfalls.
 * 
 * std140 Rules:
 * - f32:       4-byte size,  4-byte alignment
 * - vec2<f32>: 8-byte size,  8-byte alignment
 * - vec3<f32>: 12-byte size, 16-byte alignment (THE TRAP!)
 * - vec4<f32>: 16-byte size, 16-byte alignment
 * - mat4x4:    64-byte size, 16-byte alignment
 * - Arrays:    Element stride rounded to 16 bytes
 * - Structs:   Base alignment = largest member, rounded to 16
 */

// Type definitions with std140 alignment requirements
export const STD140_TYPES = {
    f32:     { size: 4,  align: 4,  components: 1 },
    i32:     { size: 4,  align: 4,  components: 1 },
    u32:     { size: 4,  align: 4,  components: 1 },
    vec2f:   { size: 8,  align: 8,  components: 2 },
    vec2i:   { size: 8,  align: 8,  components: 2 },
    vec2u:   { size: 8,  align: 8,  components: 2 },
    vec3f:   { size: 12, align: 16, components: 3 },  // THE TRAP: 12 bytes but 16 alignment
    vec3i:   { size: 12, align: 16, components: 3 },
    vec3u:   { size: 12, align: 16, components: 3 },
    vec4f:   { size: 16, align: 16, components: 4 },
    vec4i:   { size: 16, align: 16, components: 4 },
    vec4u:   { size: 16, align: 16, components: 4 },
    mat2x2f: { size: 32, align: 16, components: 4 },   // 2 vec4 columns (padded)
    mat3x3f: { size: 48, align: 16, components: 12 },  // 3 vec4 columns (padded)
    mat4x4f: { size: 64, align: 16, components: 16 },
};

/**
 * Calculate aligned offset for a field
 * @param {number} currentOffset - Current byte offset
 * @param {number} alignment - Required alignment
 * @returns {number} - Aligned offset
 */
export function alignOffset(currentOffset, alignment) {
    return Math.ceil(currentOffset / alignment) * alignment;
}

/**
 * Std140StructBuilder - Build CPU-side structs that match GPU layout exactly
 */
export class Std140StructBuilder {
    constructor(name = 'UnnamedStruct') {
        this.name = name;
        this.fields = [];
        this.currentOffset = 0;
        this.maxAlignment = 0;
    }
    
    /**
     * Add a field to the struct
     * @param {string} name - Field name
     * @param {string} type - Type name from STD140_TYPES
     * @param {*} defaultValue - Default value
     * @returns {Std140StructBuilder} - this for chaining
     */
    addField(name, type, defaultValue = null) {
        const typeInfo = STD140_TYPES[type];
        if (!typeInfo) {
            throw new Error(`[Std140] Unknown type: ${type}`);
        }
        
        // Align to type's requirement
        const alignedOffset = alignOffset(this.currentOffset, typeInfo.align);
        const padding = alignedOffset - this.currentOffset;
        
        this.fields.push({
            name,
            type,
            offset: alignedOffset,
            size: typeInfo.size,
            align: typeInfo.align,
            components: typeInfo.components,
            padding,
            defaultValue,
        });
        
        this.currentOffset = alignedOffset + typeInfo.size;
        this.maxAlignment = Math.max(this.maxAlignment, typeInfo.align);
        
        return this;
    }
    
    /**
     * Add explicit padding (useful for matching existing GPU structs)
     * @param {number} bytes - Bytes to pad
     * @returns {Std140StructBuilder}
     */
    addPadding(bytes) {
        this.currentOffset += bytes;
        return this;
    }
    
    /**
     * Finalize struct - ensures size is multiple of max alignment
     * @returns {Std140StructLayout}
     */
    build() {
        // Struct size must be multiple of largest alignment (for arrays)
        const finalAlignment = Math.max(this.maxAlignment, 16);
        const structSize = alignOffset(this.currentOffset, finalAlignment);
        
        return new Std140StructLayout(this.name, this.fields, structSize, finalAlignment);
    }
}

/**
 * Std140StructLayout - Immutable layout definition with write methods
 */
export class Std140StructLayout {
    constructor(name, fields, size, alignment) {
        this.name = name;
        this.fields = fields;
        this.size = size;
        this.alignment = alignment;
        
        // Build field lookup map
        this.fieldMap = new Map();
        for (const field of fields) {
            this.fieldMap.set(field.name, field);
        }
    }
    
    /**
     * Get field info by name
     * @param {string} name 
     * @returns {Object|null}
     */
    getField(name) {
        return this.fieldMap.get(name) || null;
    }
    
    /**
     * Create a typed array buffer for this struct
     * @returns {ArrayBuffer}
     */
    createBuffer() {
        return new ArrayBuffer(this.size);
    }
    
    /**
     * Create a Float32Array view (for uniform writes)
     * @param {ArrayBuffer} buffer 
     * @returns {Float32Array}
     */
    createFloat32View(buffer) {
        return new Float32Array(buffer);
    }
    
    /**
     * Write a value to the buffer at the field's offset
     * @param {ArrayBuffer} buffer 
     * @param {string} fieldName 
     * @param {number|Array} value 
     */
    writeField(buffer, fieldName, value) {
        const field = this.fieldMap.get(fieldName);
        if (!field) {
            throw new Error(`[Std140] Unknown field: ${fieldName} in ${this.name}`);
        }
        
        const view = new Float32Array(buffer, field.offset, field.components);
        
        if (Array.isArray(value)) {
            for (let i = 0; i < Math.min(value.length, field.components); i++) {
                view[i] = value[i];
            }
        } else if (typeof value === 'number') {
            view[0] = value;
        } else if (value && typeof value === 'object') {
            // Handle objects with x,y,z,w or r,g,b,a properties
            if ('x' in value) {
                view[0] = value.x ?? 0;
                if (field.components > 1) view[1] = value.y ?? 0;
                if (field.components > 2) view[2] = value.z ?? 0;
                if (field.components > 3) view[3] = value.w ?? 0;
            } else if ('r' in value) {
                view[0] = value.r ?? 0;
                if (field.components > 1) view[1] = value.g ?? 0;
                if (field.components > 2) view[2] = value.b ?? 0;
                if (field.components > 3) view[3] = value.a ?? 1;
            }
        }
    }
    
    /**
     * Write a 4x4 matrix to the buffer
     * @param {ArrayBuffer} buffer 
     * @param {string} fieldName 
     * @param {Float32Array|Array} matrix - 16-element column-major matrix
     */
    writeMatrix4(buffer, fieldName, matrix) {
        const field = this.fieldMap.get(fieldName);
        if (!field || field.type !== 'mat4x4f') {
            throw new Error(`[Std140] Field ${fieldName} is not mat4x4f`);
        }
        
        const view = new Float32Array(buffer, field.offset, 16);
        for (let i = 0; i < 16; i++) {
            view[i] = matrix[i] ?? 0;
        }
    }
    
    /**
     * Validate layout against expected offsets (for debugging)
     * @param {Object} expectedOffsets - { fieldName: expectedOffset }
     * @returns {boolean}
     */
    validate(expectedOffsets) {
        let valid = true;
        for (const [name, expected] of Object.entries(expectedOffsets)) {
            const field = this.fieldMap.get(name);
            if (!field) {
                console.error(`[Std140] Validation: Missing field ${name}`);
                valid = false;
            } else if (field.offset !== expected) {
                console.error(`[Std140] Validation: ${name} offset mismatch. Expected ${expected}, got ${field.offset}`);
                valid = false;
            }
        }
        return valid;
    }
    
    /**
     * Debug: Print layout information
     */
    debugPrint() {
        console.log(`[Std140] Struct: ${this.name} (${this.size} bytes, align ${this.alignment})`);
        for (const field of this.fields) {
            const padStr = field.padding > 0 ? ` (+${field.padding} padding)` : '';
            console.log(`  [${field.offset.toString().padStart(3)}] ${field.name}: ${field.type}${padStr}`);
        }
    }
}

/**
 * Create a FrameUniforms layout matching the VoxelRenderer
 */
export function createFrameUniformsLayout() {
    return new Std140StructBuilder('FrameUniforms')
        .addField('viewProj', 'mat4x4f')           // 0
        .addField('view', 'mat4x4f')               // 64
        .addField('proj', 'mat4x4f')               // 128
        .addField('lightViewProj', 'mat4x4f')      // 192
        .addField('waterViewProj', 'mat4x4f')      // 256
        .addField('cameraPos', 'vec3f')            // 320
        .addField('time', 'f32')                   // 332
        .addField('sunDirection', 'vec3f')         // 336 (aligned to 16 = 336)
        .addField('sunIntensity', 'f32')           // 348
        .addField('sunColor', 'vec3f')             // 352 (aligned to 16 = 352)
        .addField('ambientLight', 'f32')           // 364
        .addField('shaderMode', 'f32')             // 368
        .addField('shadowBias', 'f32')             // 372
        .addField('shadowStrength', 'f32')         // 376
        .addPadding(4)                             // 380 padding
        .addField('fogColor', 'vec3f')             // 384 (aligned to 16 = 384)
        .addField('fogDensity', 'f32')             // 396
        .addField('waterEnabled', 'f32')           // 400
        .addPadding(12)                            // 404-416 padding for vec3 alignment
        // Terrain config...
        .addField('triplanarScale', 'f32')         // 416
        .addField('triplanarSharpness', 'f32')     // 420
        .addField('triplanarEnabled', 'f32')       // 424
        .addField('slopeBlendEnabled', 'f32')      // 428
        .addField('grassSlopeMax', 'f32')          // 432
        .addField('dirtSlopeMax', 'f32')           // 436
        .addField('rockSlopeMin', 'f32')           // 440
        .addField('heightBlendEnabled', 'f32')     // 444
        .addField('sandHeightMax', 'f32')          // 448
        .addField('snowHeightMin', 'f32')          // 452
        .addField('peakRockHeight', 'f32')         // 456
        .addField('biomeColorsEnabled', 'f32')     // 460
        .addField('edgeDarkening', 'f32')          // 464
        .addField('noiseIntensity', 'f32')         // 468
        .addField('fineDetailIntensity', 'f32')    // 472
        .addField('biomeBlendSharpness', 'f32')    // 476
        .build();
}

/**
 * Create a ChunkUniforms layout
 */
export function createChunkUniformsLayout() {
    return new Std140StructBuilder('ChunkUniforms')
        .addField('worldOffset', 'vec3f')          // 0
        .addField('blend', 'f32')                  // 12
        .addField('morphFactor', 'f32')            // 16
        .addField('lodLevel', 'f32')               // 20
        .addField('cameraDistance', 'f32')         // 24
        .addPadding(4)                             // 28 padding
        .build();
}

/**
 * Create a MaterialUniforms layout for PBR materials
 */
export function createPBRMaterialLayout() {
    return new Std140StructBuilder('PBRMaterial')
        .addField('baseColor', 'vec4f')            // 0
        .addField('emissive', 'vec3f')             // 16
        .addField('metallic', 'f32')               // 28
        .addField('roughness', 'f32')              // 32
        .addField('ao', 'f32')                     // 36
        .addField('normalScale', 'f32')            // 40
        .addField('alphaCutoff', 'f32')            // 44
        .build();
}

export default {
    STD140_TYPES,
    alignOffset,
    Std140StructBuilder,
    Std140StructLayout,
    createFrameUniformsLayout,
    createChunkUniformsLayout,
    createPBRMaterialLayout,
};
