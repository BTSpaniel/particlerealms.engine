// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shader Reflection - Parse WGSL to extract bindings, uniforms, entry points
 */

import { legacyStringHash32 } from '../math/ChecksumMath.js';

export class VGPUShaderReflection {
    constructor() {
        this._cache = new Map();  // source hash -> reflection data
    }

    /**
     * Analyze WGSL shader source and extract metadata
     * @param {string} source - WGSL shader source
     * @returns {Object} Reflection data
     */
    reflect(source) {
        const hash = this._hash(source);
        if (this._cache.has(hash)) {
            return this._cache.get(hash);
        }

        const reflection = {
            entryPoints: this._extractEntryPoints(source),
            bindings: this._extractBindings(source),
            structs: this._extractStructs(source),
            constants: this._extractConstants(source),
            workgroupSize: this._extractWorkgroupSize(source),
        };

        this._cache.set(hash, reflection);
        return reflection;
    }

    /**
     * Get bind group layout entries from reflection
     */
    getBindGroupLayoutEntries(source, group = 0) {
        const reflection = this.reflect(source);
        const entries = [];

        for (const binding of reflection.bindings) {
            if (binding.group === group) {
                entries.push({
                    binding: binding.binding,
                    visibility: this._getVisibility(binding.stages),
                    ...this._getBindingType(binding),
                });
            }
        }

        return entries.sort((a, b) => a.binding - b.binding);
    }

    /**
     * Get all bind groups used in shader
     */
    getBindGroups(source) {
        const reflection = this.reflect(source);
        const groups = new Map();

        for (const binding of reflection.bindings) {
            if (!groups.has(binding.group)) {
                groups.set(binding.group, []);
            }
            groups.get(binding.group).push(binding);
        }

        return groups;
    }

    _extractEntryPoints(source) {
        const entryPoints = [];
        const regex = /@(vertex|fragment|compute)\s*(?:@workgroup_size\s*\([^)]+\))?\s*fn\s+(\w+)/g;
        let match;

        while ((match = regex.exec(source)) !== null) {
            entryPoints.push({
                name: match[2],
                stage: match[1],
            });
        }

        return entryPoints;
    }

    _extractBindings(source) {
        const bindings = [];
        // Match @group(N) @binding(M) var<...> name: Type;
        const regex = /@group\s*\(\s*(\d+)\s*\)\s*@binding\s*\(\s*(\d+)\s*\)\s*var(?:<([^>]+)>)?\s+(\w+)\s*:\s*([^;]+)/g;
        let match;

        while ((match = regex.exec(source)) !== null) {
            const [, group, binding, addressSpace, name, type] = match;
            const stages = this._inferStages(source, name);

            bindings.push({
                group: parseInt(group),
                binding: parseInt(binding),
                name,
                type: type.trim(),
                addressSpace: addressSpace || 'handle',
                stages,
                ...this._parseBindingType(addressSpace, type.trim()),
            });
        }

        return bindings;
    }

    _extractStructs(source) {
        const structs = [];
        const structRegex = /struct\s+(\w+)\s*\{([^}]+)\}/g;
        let match;

        while ((match = structRegex.exec(source)) !== null) {
            const [, name, body] = match;
            const members = this._parseStructMembers(body);
            const size = this._calculateStructSize(members);

            structs.push({
                name,
                members,
                size,
                alignment: this._calculateStructAlignment(members),
            });
        }

        return structs;
    }

    _parseStructMembers(body) {
        const members = [];
        const memberRegex = /(?:@(\w+)(?:\s*\(\s*(\d+)\s*\))?\s+)*(\w+)\s*:\s*([^,}]+)/g;
        let match;
        let offset = 0;

        while ((match = memberRegex.exec(body)) !== null) {
            const [, attr, attrValue, name, type] = match;
            const typeInfo = this._getTypeInfo(type.trim());
            const alignment = typeInfo.alignment;

            // Align offset
            offset = Math.ceil(offset / alignment) * alignment;

            members.push({
                name,
                type: type.trim(),
                offset,
                size: typeInfo.size,
                alignment,
                attribute: attr,
                attributeValue: attrValue ? parseInt(attrValue) : undefined,
            });

            offset += typeInfo.size;
        }

        return members;
    }

    _calculateStructSize(members) {
        if (members.length === 0) return 0;
        const last = members[members.length - 1];
        const rawSize = last.offset + last.size;
        const maxAlign = Math.max(...members.map(m => m.alignment));
        return Math.ceil(rawSize / maxAlign) * maxAlign;
    }

    _calculateStructAlignment(members) {
        if (members.length === 0) return 4;
        return Math.max(...members.map(m => m.alignment));
    }

    _extractConstants(source) {
        const constants = [];
        const regex = /(?:const|override)\s+(\w+)\s*(?::\s*(\w+))?\s*=\s*([^;]+)/g;
        let match;

        while ((match = regex.exec(source)) !== null) {
            const [, name, type, value] = match;
            constants.push({
                name,
                type: type || 'inferred',
                value: value.trim(),
                isOverride: match[0].startsWith('override'),
            });
        }

        return constants;
    }

    _extractWorkgroupSize(source) {
        const match = source.match(/@workgroup_size\s*\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/);
        if (!match) return null;

        return {
            x: parseInt(match[1]),
            y: match[2] ? parseInt(match[2]) : 1,
            z: match[3] ? parseInt(match[3]) : 1,
        };
    }

    _inferStages(source, bindingName) {
        const stages = new Set();

        // Check if used in vertex shader
        if (source.match(new RegExp(`@vertex[\\s\\S]*?fn\\s+\\w+[\\s\\S]*?\\b${bindingName}\\b`))) {
            stages.add('vertex');
        }
        // Check if used in fragment shader
        if (source.match(new RegExp(`@fragment[\\s\\S]*?fn\\s+\\w+[\\s\\S]*?\\b${bindingName}\\b`))) {
            stages.add('fragment');
        }
        // Check if used in compute shader
        if (source.match(new RegExp(`@compute[\\s\\S]*?fn\\s+\\w+[\\s\\S]*?\\b${bindingName}\\b`))) {
            stages.add('compute');
        }

        // If we can't determine, assume all stages
        if (stages.size === 0) {
            const hasVertex = source.includes('@vertex');
            const hasFragment = source.includes('@fragment');
            const hasCompute = source.includes('@compute');
            if (hasVertex) stages.add('vertex');
            if (hasFragment) stages.add('fragment');
            if (hasCompute) stages.add('compute');
        }

        return Array.from(stages);
    }

    _parseBindingType(addressSpace, type) {
        // Determine binding kind
        if (type.startsWith('texture_')) {
            return { kind: 'texture', textureType: type };
        }
        if (type.startsWith('sampler')) {
            return { kind: 'sampler', samplerType: type === 'sampler_comparison' ? 'comparison' : 'filtering' };
        }
        if (type.startsWith('texture_storage_')) {
            return { kind: 'storageTexture', textureType: type };
        }

        // Buffer types
        if (addressSpace === 'uniform') {
            return { kind: 'uniform' };
        }
        if (addressSpace === 'storage' || addressSpace === 'storage, read_write') {
            return { kind: 'storage', access: 'read_write' };
        }
        if (addressSpace === 'storage, read') {
            return { kind: 'storage', access: 'read' };
        }

        return { kind: 'unknown' };
    }

    _getBindingType(binding) {
        switch (binding.kind) {
            case 'uniform':
                return { buffer: { type: 'uniform' } };
            case 'storage':
                return { buffer: { type: binding.access === 'read' ? 'read-only-storage' : 'storage' } };
            case 'texture':
                return { texture: this._getTextureBindingLayout(binding.textureType) };
            case 'storageTexture':
                return { storageTexture: this._getStorageTextureLayout(binding.textureType) };
            case 'sampler':
                return { sampler: { type: binding.samplerType } };
            default:
                return {};
        }
    }

    _getTextureBindingLayout(type) {
        const layout = { sampleType: 'float', viewDimension: '2d' };

        if (type.includes('_depth')) layout.sampleType = 'depth';
        if (type.includes('_sint')) layout.sampleType = 'sint';
        if (type.includes('_uint')) layout.sampleType = 'uint';

        if (type.includes('_1d')) layout.viewDimension = '1d';
        if (type.includes('_2d_array')) layout.viewDimension = '2d-array';
        else if (type.includes('_2d')) layout.viewDimension = '2d';
        if (type.includes('_3d')) layout.viewDimension = '3d';
        if (type.includes('_cube_array')) layout.viewDimension = 'cube-array';
        else if (type.includes('_cube')) layout.viewDimension = 'cube';
        if (type.includes('_multisampled')) layout.multisampled = true;

        return layout;
    }

    _getStorageTextureLayout(type) {
        const layout = { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' };

        // Extract format from type like texture_storage_2d<rgba8unorm, write>
        const formatMatch = type.match(/<(\w+)/);
        if (formatMatch) layout.format = formatMatch[1];

        if (type.includes('_1d')) layout.viewDimension = '1d';
        if (type.includes('_2d_array')) layout.viewDimension = '2d-array';
        if (type.includes('_3d')) layout.viewDimension = '3d';

        return layout;
    }

    _getVisibility(stages) {
        let visibility = 0;
        if (stages.includes('vertex')) visibility |= GPUShaderStage.VERTEX;
        if (stages.includes('fragment')) visibility |= GPUShaderStage.FRAGMENT;
        if (stages.includes('compute')) visibility |= GPUShaderStage.COMPUTE;
        return visibility;
    }

    _getTypeInfo(type) {
        const types = {
            'f32': { size: 4, alignment: 4 },
            'i32': { size: 4, alignment: 4 },
            'u32': { size: 4, alignment: 4 },
            'f16': { size: 2, alignment: 2 },
            'vec2f': { size: 8, alignment: 8 },
            'vec2i': { size: 8, alignment: 8 },
            'vec2u': { size: 8, alignment: 8 },
            'vec2<f32>': { size: 8, alignment: 8 },
            'vec3f': { size: 12, alignment: 16 },
            'vec3i': { size: 12, alignment: 16 },
            'vec3u': { size: 12, alignment: 16 },
            'vec3<f32>': { size: 12, alignment: 16 },
            'vec4f': { size: 16, alignment: 16 },
            'vec4i': { size: 16, alignment: 16 },
            'vec4u': { size: 16, alignment: 16 },
            'vec4<f32>': { size: 16, alignment: 16 },
            'mat2x2f': { size: 16, alignment: 8 },
            'mat2x2<f32>': { size: 16, alignment: 8 },
            'mat3x3f': { size: 48, alignment: 16 },
            'mat3x3<f32>': { size: 48, alignment: 16 },
            'mat4x4f': { size: 64, alignment: 16 },
            'mat4x4<f32>': { size: 64, alignment: 16 },
        };

        // Check for array types
        const arrayMatch = type.match(/array<([^,>]+)(?:,\s*(\d+))?>/);
        if (arrayMatch) {
            const elementType = arrayMatch[1].trim();
            const count = arrayMatch[2] ? parseInt(arrayMatch[2]) : 0;
            const elementInfo = this._getTypeInfo(elementType);
            const stride = Math.ceil(elementInfo.size / 16) * 16; // Array stride alignment
            return {
                size: count > 0 ? stride * count : 0,
                alignment: 16,
            };
        }

        return types[type] || { size: 4, alignment: 4 };
    }

    _hash(str) {
        return legacyStringHash32(str).toString(36);
    }

    /**
     * Clear reflection cache
     */
    clearCache() {
        this._cache.clear();
    }
}

// Singleton instance
let _reflectionInstance = null;

export function getShaderReflection() {
    if (!_reflectionInstance) {
        _reflectionInstance = new VGPUShaderReflection();
    }
    return _reflectionInstance;
}

// ============================================================================
// AUTO-SIZED BUFFER UTILITIES
// ============================================================================

/**
 * Get the required buffer size for a uniform struct in a shader.
 * Automatically calculates correct WGSL alignment.
 *
 * @param {string} shaderSource - WGSL shader source code
 * @param {string} structName - Name of the struct to get size for
 * @returns {number} Required buffer size in bytes
 */
export function getStructBufferSize(shaderSource, structName) {
    const reflection = getShaderReflection();
    const data = reflection.reflect(shaderSource);

    const struct = data.structs.find(s => s.name === structName);
    if (!struct) {
        console.warn(`[ShaderReflection] Struct '${structName}' not found in shader`);
        return 0;
    }

    return struct.size;
}

/**
 * Get buffer sizes for all uniform bindings in a shader.
 *
 * @param {string} shaderSource - WGSL shader source code
 * @returns {Map<string, number>} Map of binding name -> required size
 */
export function getUniformBufferSizes(shaderSource) {
    const reflection = getShaderReflection();
    const data = reflection.reflect(shaderSource);
    const sizes = new Map();

    for (const binding of data.bindings) {
        if (binding.kind === 'uniform') {
            // Find the struct type for this binding
            const structName = binding.type;
            const struct = data.structs.find(s => s.name === structName);
            if (struct) {
                sizes.set(binding.name, struct.size);
            }
        }
    }

    return sizes;
}

/**
 * Create a uniform buffer with automatically calculated size from shader struct.
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {string} shaderSource - WGSL shader source code
 * @param {string} structName - Name of the struct
 * @param {Object} options - Buffer options (label, usage flags)
 * @returns {GPUBuffer} Created buffer with correct size
 */
export function createAutoSizedUniformBuffer(device, shaderSource, structName, options = {}) {
    const size = getStructBufferSize(shaderSource, structName);

    if (size === 0) {
        console.error(`[ShaderReflection] Cannot create buffer: struct '${structName}' not found or has zero size`);
        return null;
    }

    const buffer = device.createBuffer({
        size,
        usage: options.usage ?? (GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
        label: options.label ?? `${structName}.buffer`,
        mappedAtCreation: options.mappedAtCreation ?? false,
    });

    console.log(`[ShaderReflection] Created buffer '${options.label || structName}' with auto-detected size: ${size} bytes`);

    return buffer;
}

/**
 * Validate that a buffer meets the minimum size requirement for a shader struct.
 *
 * @param {GPUBuffer} buffer - Buffer to validate
 * @param {string} shaderSource - WGSL shader source code
 * @param {string} structName - Name of the struct
 * @returns {boolean} True if buffer is large enough
 */
export function validateBufferSize(buffer, shaderSource, structName) {
    const requiredSize = getStructBufferSize(shaderSource, structName);
    const actualSize = buffer.size;

    if (actualSize < requiredSize) {
        console.error(`[ShaderReflection] Buffer size mismatch for '${structName}': buffer is ${actualSize} bytes, but struct requires ${requiredSize} bytes`);
        return false;
    }

    return true;
}

/**
 * Get all struct sizes in a shader for debugging.
 *
 * @param {string} shaderSource - WGSL shader source code
 * @returns {Object} Map of struct name -> { size, alignment, members }
 */
export function debugShaderStructs(shaderSource) {
    const reflection = getShaderReflection();
    const data = reflection.reflect(shaderSource);

    const result = {};
    for (const struct of data.structs) {
        result[struct.name] = {
            size: struct.size,
            alignment: struct.alignment,
            members: struct.members.map(m => ({
                name: m.name,
                type: m.type,
                offset: m.offset,
                size: m.size,
            })),
        };
    }

    console.log('[ShaderReflection] Struct sizes:', result);
    return result;
}
