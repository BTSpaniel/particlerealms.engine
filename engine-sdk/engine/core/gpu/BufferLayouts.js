// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BufferLayouts.js - GPU Buffer Layout Definitions
 * 
 * Defines Structure of Arrays (SoA) layouts for WebGPU buffers.
 * SoA is preferred over AoS (Array of Structs) for GPU compute because:
 * - Better memory coalescing (adjacent threads read adjacent memory)
 * - Easier to add/remove attributes without breaking alignment
 * - Can update subsets of data independently
 * 
 * This file provides:
 * - Buffer stride/offset calculations
 * - Alignment helpers for WebGPU requirements
 * - Fixed-point scaling for atomic operations
 * - Layout definitions for particles, grids, and fields
 */

// ============================================================================
// ALIGNMENT CONSTANTS (WebGPU Requirements)
// ============================================================================

/** Uniform buffer alignment (must be 16 bytes) */
export const UNIFORM_ALIGN = 16;

/** Storage buffer preferred alignment (4 bytes min, 16 for performance) */
export const STORAGE_ALIGN = 16;

/** Indirect dispatch buffer alignment */
export const INDIRECT_ALIGN = 4;

/** Minimum workgroup size for good occupancy */
export const MIN_WORKGROUP = 64;

/** Maximum workgroup size (WebGPU limit) */
export const MAX_WORKGROUP = 256;

// ============================================================================
// FIXED-POINT SCALING (For Atomic Operations)
// ============================================================================

/**
 * WebGPU/WGSL has no native atomicAdd for f32.
 * Solution: Scale floats to integers, use atomicAdd on i32, then descale.
 * 
 * FIXED_SCALE = 10000 gives us:
 * - 4 decimal places of precision
 * - Range: ±214,748 (i32 max / 10000)
 * - Good for velocities, forces, densities
 */
export const FIXED_SCALE = 10000.0;
export const FIXED_SCALE_INV = 1.0 / FIXED_SCALE;

/**
 * High precision scale for positions (6 decimal places)
 * Range: ±2147 units - use only for local coordinates
 */
export const FIXED_SCALE_HI = 1000000.0;
export const FIXED_SCALE_HI_INV = 1.0 / FIXED_SCALE_HI;

/**
 * Convert float to fixed-point integer
 * @param {number} value 
 * @param {number} scale 
 * @returns {number}
 */
export function toFixed(value, scale = FIXED_SCALE) {
    return Math.round(value * scale) | 0;
}

/**
 * Convert fixed-point integer back to float
 * @param {number} fixed 
 * @param {number} scale 
 * @returns {number}
 */
export function fromFixed(fixed, scale = FIXED_SCALE) {
    return fixed / scale;
}

// ============================================================================
// ALIGNMENT HELPERS
// ============================================================================

/**
 * Align a size/offset to the specified boundary
 * @param {number} size - Current size in bytes
 * @param {number} align - Alignment boundary
 * @returns {number} - Aligned size
 */
export function alignTo(size, align) {
    return Math.ceil(size / align) * align;
}

/**
 * Calculate padding needed to reach alignment
 * @param {number} size 
 * @param {number} align 
 * @returns {number}
 */
export function paddingFor(size, align) {
    const remainder = size % align;
    return remainder === 0 ? 0 : align - remainder;
}

/**
 * Validate that a size meets alignment requirements
 * @param {number} size 
 * @param {number} align 
 * @returns {boolean}
 */
export function isAligned(size, align) {
    return size % align === 0;
}

// ============================================================================
// TYPE SIZES (WGSL Types in Bytes)
// ============================================================================

export const TYPE_SIZES = {
    f32: 4,
    i32: 4,
    u32: 4,
    vec2f: 8,
    vec3f: 12,  // Note: vec3 is padded to 16 in uniform buffers
    vec4f: 16,
    mat3x3f: 48, // 3 vec4f columns (padded)
    mat4x4f: 64,
    'atomic<i32>': 4,
    'atomic<u32>': 4,
};

// ============================================================================
// PARTICLE BUFFER LAYOUTS (MLS-MPM)
// ============================================================================

/**
 * MLS-MPM Particle SoA Layout
 * 
 * Buffer 0: Position + Mass (vec4f) - 16 bytes
 *   [x, y, z, mass]
 * 
 * Buffer 1: Velocity + Padding (vec4f) - 16 bytes
 *   [vx, vy, vz, pad]
 * 
 * Buffer 2: Deformation Gradient (mat3x3f) - 48 bytes
 *   Row-major 3x3 matrix for plasticity
 * 
 * Buffer 3: Affine Momentum (mat3x3f) - 48 bytes
 *   APIC affine velocity field
 * 
 * Total per particle: 128 bytes
 */
export const PARTICLE_LAYOUT = {
    POSITION_MASS: {
        index: 0,
        stride: 16,
        format: 'vec4f',
        offsets: { x: 0, y: 4, z: 8, mass: 12 },
    },
    VELOCITY: {
        index: 1,
        stride: 16,
        format: 'vec4f',
        offsets: { vx: 0, vy: 4, vz: 8, pad: 12 },
    },
    DEF_GRADIENT: {
        index: 2,
        stride: 48,
        format: 'mat3x3f',
        offsets: { m00: 0, m01: 4, m02: 8, m10: 16, m11: 20, m12: 24, m20: 32, m21: 36, m22: 40 },
    },
    AFFINE_C: {
        index: 3,
        stride: 48,
        format: 'mat3x3f',
        offsets: { c00: 0, c01: 4, c02: 8, c10: 16, c11: 20, c12: 24, c20: 32, c21: 36, c22: 40 },
    },
    TOTAL_STRIDE: 128,
};

/**
 * Calculate buffer sizes for particle system
 * @param {number} particleCount 
 * @returns {Object}
 */
export function getParticleBufferSizes(particleCount) {
    return {
        positionMass: particleCount * PARTICLE_LAYOUT.POSITION_MASS.stride,
        velocity: particleCount * PARTICLE_LAYOUT.VELOCITY.stride,
        defGradient: particleCount * PARTICLE_LAYOUT.DEF_GRADIENT.stride,
        affineC: particleCount * PARTICLE_LAYOUT.AFFINE_C.stride,
        total: particleCount * PARTICLE_LAYOUT.TOTAL_STRIDE,
    };
}

// ============================================================================
// GRID BUFFER LAYOUTS (MLS-MPM)
// ============================================================================

/**
 * MLS-MPM Grid Cell Layout (Fixed-Point for Atomics)
 * 
 * Each cell stores accumulated values from P2G scatter.
 * Uses atomic<i32> for thread-safe accumulation.
 * 
 * Momentum: vec3 as 3x atomic<i32> - 12 bytes
 *   [mom_x, mom_y, mom_z] (fixed-point scaled)
 * 
 * Mass: atomic<i32> - 4 bytes
 *   (fixed-point scaled)
 * 
 * Total per cell: 16 bytes (nicely aligned)
 */
export const GRID_CELL_LAYOUT = {
    stride: 16,
    format: 'vec4<atomic<i32>>',
    offsets: {
        momentum_x: 0,
        momentum_y: 4,
        momentum_z: 8,
        mass: 12,
    },
};

/**
 * Grid velocity output (after grid update)
 * Standard f32 for reading in G2P
 */
export const GRID_VELOCITY_LAYOUT = {
    stride: 16,
    format: 'vec4f',
    offsets: { vx: 0, vy: 4, vz: 8, pad: 12 },
};

/**
 * Calculate grid buffer size
 * @param {number} gridX - Grid cells in X
 * @param {number} gridY - Grid cells in Y
 * @param {number} gridZ - Grid cells in Z
 * @returns {Object}
 */
export function getGridBufferSizes(gridX, gridY, gridZ) {
    const cellCount = gridX * gridY * gridZ;
    return {
        cellCount,
        atomicBuffer: cellCount * GRID_CELL_LAYOUT.stride,
        velocityBuffer: cellCount * GRID_VELOCITY_LAYOUT.stride,
    };
}

// ============================================================================
// FDTD FIELD LAYOUTS (Chrono-Photonic)
// ============================================================================

/**
 * FDTD Electromagnetic Field Cell
 * 
 * Electric Displacement D: vec3f - 12 bytes (padded to 16)
 * Magnetic Induction B: vec3f - 12 bytes (padded to 16)
 * Permittivity ε: f32 - 4 bytes
 * Permeability μ: f32 - 4 bytes
 * Padding: 8 bytes
 * 
 * Total: 48 bytes per cell
 */
export const FDTD_CELL_LAYOUT = {
    stride: 48,
    offsets: {
        Dx: 0, Dy: 4, Dz: 8, pad0: 12,
        Bx: 16, By: 20, Bz: 24, pad1: 28,
        epsilon: 32, mu: 36, pad2: 40, pad3: 44,
    },
};

/**
 * Phasor Ray Layout
 * Position: vec3f - 12 bytes (padded to 16)
 * Direction: vec3f - 12 bytes (padded to 16)
 * Amplitude, Frequency, Phase, Pad: vec4f - 16 bytes
 * 
 * Total: 48 bytes per ray
 */
export const PHASOR_RAY_LAYOUT = {
    stride: 48,
    offsets: {
        px: 0, py: 4, pz: 8, pad0: 12,
        dx: 16, dy: 20, dz: 24, pad1: 28,
        amplitude: 32, frequency: 36, phase: 40, pad2: 44,
    },
};

// ============================================================================
// INDIRECT DISPATCH LAYOUTS
// ============================================================================

/**
 * Indirect dispatch buffer layout
 * @see https://www.w3.org/TR/webgpu/#dictdef-gpucomputepassencoder-dispatchworkgroupsindirect
 */
export const INDIRECT_DISPATCH_LAYOUT = {
    stride: 12, // 3 x u32
    offsets: {
        workgroupCountX: 0,
        workgroupCountY: 4,
        workgroupCountZ: 8,
    },
};

/**
 * Indirect draw buffer layout (for instanced rendering)
 */
export const INDIRECT_DRAW_LAYOUT = {
    stride: 20, // 5 x u32
    offsets: {
        vertexCount: 0,
        instanceCount: 4,
        firstVertex: 8,
        firstInstance: 12,
        // Extra slot for atomic counter
        counter: 16,
    },
};

// ============================================================================
// CHUNK & VOXEL LAYOUTS
// ============================================================================

/**
 * Dirty chunk entry for conditional dispatch
 */
export const DIRTY_CHUNK_LAYOUT = {
    stride: 16,
    offsets: {
        chunkX: 0,
        chunkY: 4,
        chunkZ: 8,
        flags: 12, // Bitmask: GEOMETRY=0x01, LIGHTING=0x02, BOUNDARY=0x04
    },
};

/** Dirty flags bitmask */
export const DIRTY_FLAGS = {
    NONE: 0x00,
    GEOMETRY: 0x01,   // Mesh needs rebuild, triggers JFA + DDGI
    LIGHTING: 0x02,   // DDGI probes need update
    BOUNDARY: 0x04,   // Neighbor chunk changed (need seam handling)
    DAMAGE: 0x08,     // HIGH PRIORITY - damage/destruction, process first
    ALL: 0x0F,
};

// ============================================================================
// BUFFER CREATION HELPERS
// ============================================================================

/**
 * Create a WebGPU buffer with proper alignment
 * @param {GPUDevice} device 
 * @param {number} size - Size in bytes
 * @param {GPUBufferUsageFlags} usage 
 * @param {string} label 
 * @returns {GPUBuffer}
 */
export function createAlignedBuffer(device, size, usage, label = '') {
    const alignedSize = alignTo(size, STORAGE_ALIGN);
    return device.createBuffer({
        size: alignedSize,
        usage,
        label,
        mappedAtCreation: false,
    });
}

/**
 * Create a mapped buffer for initial data upload
 * @param {GPUDevice} device 
 * @param {ArrayBuffer|TypedArray} data 
 * @param {GPUBufferUsageFlags} usage 
 * @param {string} label 
 * @returns {GPUBuffer}
 */
export function createBufferWithData(device, data, usage, label = '') {
    const buffer = device.createBuffer({
        size: alignTo(data.byteLength, STORAGE_ALIGN),
        usage: usage | GPUBufferUsage.COPY_DST,
        label,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

/**
 * Create uniform buffer with proper padding
 * @param {GPUDevice} device 
 * @param {number} size 
 * @param {string} label 
 * @returns {GPUBuffer}
 */
export function createUniformBuffer(device, size, label = '') {
    return device.createBuffer({
        size: alignTo(size, UNIFORM_ALIGN),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label,
    });
}

// ============================================================================
// STRUCT DEFINITIONS (For Reference in WGSL)
// ============================================================================

/**
 * Generate WGSL struct definition from layout
 * @param {string} name - Struct name
 * @param {Object} layout - Layout object with offsets
 * @returns {string} WGSL code
 */
export function generateWGSLStruct(name, layout) {
    // This is a helper for documentation/reference
    // Actual WGSL structs should be written in shader files
    const lines = [`struct ${name} {`];
    
    for (const [field, offset] of Object.entries(layout.offsets)) {
        if (!field.startsWith('pad')) {
            lines.push(`    ${field}: f32, // offset ${offset}`);
        }
    }
    
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// WGSL CODE SNIPPETS (For Shader Includes)
// ============================================================================

export const WGSL_FIXED_POINT = `
// Fixed-point scaling for atomic operations
const FIXED_SCALE: f32 = 10000.0;
const FIXED_SCALE_INV: f32 = 0.0001;

fn toFixed(value: f32) -> i32 {
    return i32(round(value * FIXED_SCALE));
}

fn fromFixed(fixed: i32) -> f32 {
    return f32(fixed) * FIXED_SCALE_INV;
}

// Atomic add for vec3 (3 separate atomics)
fn atomicAddVec3(ptr: ptr<storage, array<atomic<i32>>, read_write>, idx: u32, v: vec3f) {
    atomicAdd(&(*ptr)[idx * 4u + 0u], toFixed(v.x));
    atomicAdd(&(*ptr)[idx * 4u + 1u], toFixed(v.y));
    atomicAdd(&(*ptr)[idx * 4u + 2u], toFixed(v.z));
}

fn atomicAddScalar(ptr: ptr<storage, array<atomic<i32>>, read_write>, idx: u32, v: f32) {
    atomicAdd(&(*ptr)[idx * 4u + 3u], toFixed(v));
}
`;

export const WGSL_GRID_INDEX = `
// Grid indexing helpers
fn gridIndex3D(x: u32, y: u32, z: u32, gridSize: vec3u) -> u32 {
    return x + y * gridSize.x + z * gridSize.x * gridSize.y;
}

fn gridIndex1Dto3D(idx: u32, gridSize: vec3u) -> vec3u {
    let z = idx / (gridSize.x * gridSize.y);
    let rem = idx % (gridSize.x * gridSize.y);
    let y = rem / gridSize.x;
    let x = rem % gridSize.x;
    return vec3u(x, y, z);
}
`;

export default {
    UNIFORM_ALIGN,
    STORAGE_ALIGN,
    FIXED_SCALE,
    PARTICLE_LAYOUT,
    GRID_CELL_LAYOUT,
    FDTD_CELL_LAYOUT,
    DIRTY_FLAGS,
    toFixed,
    fromFixed,
    alignTo,
    createAlignedBuffer,
    createBufferWithData,
};
