// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DynamicUniformBuffer.js - Self-sizing uniform buffer from WGSL struct
 * 
 * Pass in your WGSL struct definition (the same string embedded in your shader)
 * and this class handles:
 *   - Parsing field names, types, and byte offsets (with correct WGSL alignment)
 *   - Creating the GPU buffer at exactly the right size
 *   - Typed CPU-side Float32Array + Uint32Array views
 *   - Named setters: buf.set('sunDir', [0.2, -1.0, 0.1])
 *   - Bulk setter: buf.setAll({ viewProj: mat, cameraPos: [x,y,z] })
 *   - Single upload() call to push to GPU
 * 
 * Usage:
 *   const frame = new DynamicUniformBuffer(device, `struct FrameUniforms {
 *     viewProj: mat4x4<f32>,
 *     cameraPos: vec3<f32>,
 *     time: f32,
 *     sunDir: vec3<f32>,
 *     sunIntensity: f32,
 *   }`, 'MyFrame');
 * 
 *   frame.set('viewProj', viewProjMatrix);
 *   frame.set('cameraPos', [x, y, z]);
 *   frame.set('sunDir', lightManager.sunDirection);
 *   frame.set('sunIntensity', 1.85);
 *   frame.upload();
 * 
 *   // Or bulk:
 *   frame.setAll({ viewProj: mat, cameraPos: pos, sunDir: dir, sunIntensity: 1.0 });
 *   frame.upload();
 * 
 *   // Use in bind group:
 *   { binding: 0, resource: { buffer: frame.buffer } }
 */

// WGSL type sizes, alignments, and component counts
const TYPES = {
    'f32':          { size: 4,  align: 4,  components: 1,  isU32: false },
    'i32':          { size: 4,  align: 4,  components: 1,  isU32: true  },
    'u32':          { size: 4,  align: 4,  components: 1,  isU32: true  },
    'vec2<f32>':    { size: 8,  align: 8,  components: 2,  isU32: false },
    'vec2<i32>':    { size: 8,  align: 8,  components: 2,  isU32: true  },
    'vec2<u32>':    { size: 8,  align: 8,  components: 2,  isU32: true  },
    'vec2f':        { size: 8,  align: 8,  components: 2,  isU32: false },
    'vec3<f32>':    { size: 12, align: 16, components: 3,  isU32: false },
    'vec3<i32>':    { size: 12, align: 16, components: 3,  isU32: true  },
    'vec3<u32>':    { size: 12, align: 16, components: 3,  isU32: true  },
    'vec3f':        { size: 12, align: 16, components: 3,  isU32: false },
    'vec4<f32>':    { size: 16, align: 16, components: 4,  isU32: false },
    'vec4<i32>':    { size: 16, align: 16, components: 4,  isU32: true  },
    'vec4<u32>':    { size: 16, align: 16, components: 4,  isU32: true  },
    'vec4f':        { size: 16, align: 16, components: 4,  isU32: false },
    'mat2x2<f32>':  { size: 16, align: 8,  components: 4,  isU32: false },
    'mat3x3<f32>':  { size: 48, align: 16, components: 12, isU32: false },
    'mat3x3f':      { size: 48, align: 16, components: 12, isU32: false },
    'mat4x4<f32>':  { size: 64, align: 16, components: 16, isU32: false },
    'mat4x4f':      { size: 64, align: 16, components: 16, isU32: false },
};

function resolveType(raw) {
    const t = raw.replace(/\s+/g, '');
    if (TYPES[t]) return TYPES[t];
    const lo = t.toLowerCase();
    for (const [k, v] of Object.entries(TYPES)) {
        if (k.toLowerCase() === lo) return v;
    }
    return { size: 4, align: 4, components: 1, isU32: false };
}

function alignTo(offset, align) {
    return Math.ceil(offset / align) * align;
}

/**
 * Parse WGSL struct fields into a layout map: { name → { byteOffset, floatOffset, components, isU32 } }
 */
function parseLayout(structCode) {
    const layout = new Map();
    const fieldRe = /(\w+)\s*:\s*([^,}\n]+)/g;
    let m, offset = 0, maxAlign = 4;

    while ((m = fieldRe.exec(structCode)) !== null) {
        const name = m[1].trim();
        let type = m[2].trim().replace(/,\s*$/, '').trim();
        if (name.startsWith('//') || type.startsWith('//')) continue;

        const info = resolveType(type);
        offset = alignTo(offset, info.align);

        layout.set(name, {
            byteOffset: offset,
            floatOffset: offset >> 2,
            components: info.components,
            isU32: info.isU32,
        });

        offset += info.size;
        maxAlign = Math.max(maxAlign, info.align);
    }

    // Struct-level alignment (uniform buffers require 16-byte alignment)
    const totalSize = alignTo(offset, Math.max(maxAlign, 16));
    return { layout, totalSize };
}

export class DynamicUniformBuffer {
    /**
     * @param {GPUDevice} device
     * @param {string} structCode - WGSL struct definition (copy from shader)
     * @param {string} [label]
     */
    constructor(device, structCode, label = 'DynamicUniform') {
        const { layout, totalSize } = parseLayout(structCode);

        this.device = device;
        this.label = label;
        this._layout = layout;
        this.byteSize = totalSize;
        this.floatCount = totalSize >> 2;

        // CPU-side typed views (shared ArrayBuffer)
        this._cpu = new ArrayBuffer(totalSize);
        this.f32 = new Float32Array(this._cpu);
        this.u32 = new Uint32Array(this._cpu);

        // GPU buffer
        this.buffer = device.createBuffer({
            label,
            size: totalSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Set a single field by name.
     * Accepts scalars, arrays, or Float32Array.
     * 
     *   buf.set('viewProj', float32x16);
     *   buf.set('cameraPos', [x, y, z]);
     *   buf.set('time', 1.5);
     *   buf.set('flags', 3);          // u32
     */
    set(name, value) {
        const field = this._layout.get(name);
        if (!field) return this;

        const { floatOffset, components, isU32 } = field;
        const view = isU32 ? this.u32 : this.f32;

        if (typeof value === 'number') {
            view[floatOffset] = value;
        } else if (value && value.length !== undefined) {
            // Array, Float32Array, or array-like
            const n = Math.min(value.length, components);
            for (let i = 0; i < n; i++) {
                view[floatOffset + i] = value[i];
            }
        } else if (value && typeof value === 'object') {
            // Plain object with x/y/z/w (rare, but handle it)
            if (value.x !== undefined) view[floatOffset] = value.x;
            if (value.y !== undefined) view[floatOffset + 1] = value.y;
            if (value.z !== undefined) view[floatOffset + 2] = value.z;
            if (value.w !== undefined) view[floatOffset + 3] = value.w;
        }

        return this; // chainable
    }

    /**
     * Set multiple fields at once.
     * 
     *   buf.setAll({
     *     viewProj: matrix,
     *     cameraPos: [x, y, z],
     *     time: elapsed,
     *   });
     */
    setAll(obj) {
        for (const key in obj) {
            this.set(key, obj[key]);
        }
        return this;
    }

    /**
     * Upload CPU data to GPU. Call once per frame after all sets.
     */
    upload() {
        this.device.queue.writeBuffer(this.buffer, 0, this.f32);
    }

    /**
     * Get the byte offset for a field (useful for partial writes).
     */
    offsetOf(name) {
        return this._layout.get(name)?.byteOffset ?? -1;
    }

    /**
     * Get the float index for a field.
     */
    floatIndexOf(name) {
        return this._layout.get(name)?.floatOffset ?? -1;
    }

    /**
     * Check if a field exists in the layout.
     */
    has(name) {
        return this._layout.has(name);
    }

    /**
     * Get current field names.
     */
    get fields() {
        return [...this._layout.keys()];
    }

    /**
     * Convenience: create a bind group entry for this buffer.
     *   entries: [frame.bindEntry(0)]
     */
    bindEntry(binding = 0) {
        return { binding, resource: { buffer: this.buffer } };
    }

    /**
     * Destroy GPU buffer.
     */
    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
    }
}

// Re-export parseLayout for advanced use
export { parseLayout };
