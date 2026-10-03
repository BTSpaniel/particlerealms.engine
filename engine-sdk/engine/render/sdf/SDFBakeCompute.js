// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SDFBakeCompute.js - GPU Compute Shader for 3D SDF Baking
 * Now powered by vGPU driver
 * 
 * Accelerates SDF texture generation using WebGPU compute shaders.
 * ~100x faster than CPU for high resolution (64³+) SDF textures.
 * 
 * Pipeline:
 * 1. Upload triangle data to GPU buffer
 * 2. Dispatch compute shader to calculate SDF for each voxel in parallel
 * 3. Read back SDF texture data
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// WGSL Compute Shader for SDF Baking
const SDF_BAKE_SHADER = /* wgsl */ `
struct Params {
    resolution: u32,
    triangleCount: u32,
    padding: vec2<u32>,
    boundsMin: vec3<f32>,
    _pad1: f32,
    boundsMax: vec3<f32>,
    _pad2: f32,
    size: vec3<f32>,
    _pad3: f32,
}

struct Triangle {
    v0: vec3<f32>,
    _pad0: f32,
    v1: vec3<f32>,
    _pad1: f32,
    v2: vec3<f32>,
    _pad2: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read_write> sdfOutput: array<f32>;

fn pointSegmentDistanceSquared(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> f32 {
    let edge = b - a;
    let lengthSquared = dot(edge, edge);
    var amount = 0.0;
    if (lengthSquared > 0.0) {
        amount = clamp(dot(p - a, edge) / lengthSquared, 0.0, 1.0);
    }
    let offset = p - (a + edge * amount);
    return dot(offset, offset);
}

// Plane projection avoids cancellation in barycentric denominators on thin
// stock. A truly degenerate triangle contributes its actual line segments.
fn pointToTriangleDist(p: vec3<f32>, tri: Triangle) -> f32 {
    let a = tri.v0;
    let b = tri.v1;
    let c = tri.v2;
    let ab = b - a;
    let bc = c - b;
    let ca = a - c;
    let normal = cross(ab, c - a);
    let normalSquared = dot(normal, normal);
    if (normalSquared > 0.0
        && dot(cross(ab, p - a), normal) >= 0.0
        && dot(cross(bc, p - b), normal) >= 0.0
        && dot(cross(ca, p - c), normal) >= 0.0) {
        return abs(dot(p - a, normal)) / sqrt(normalSquared);
    }
    return sqrt(min(pointSegmentDistanceSquared(p, a, b),
        min(pointSegmentDistanceSquared(p, b, c), pointSegmentDistanceSquared(p, c, a))));
}

// Canonical endpoint order makes neighbouring triangles evaluate a shared
// projected edge with identical arithmetic, even when their winding differs.
fn projectedEdge(a: vec2<f32>, b: vec2<f32>) -> f32 {
    let reversed = a.x > b.x || (a.x == b.x && a.y > b.y);
    let first = select(a, b, reversed);
    let second = select(b, a, reversed);
    let value = first.x * second.y - first.y * second.x;
    return select(value, -value, reversed);
}

fn ownsProjectedEdge(value: f32, a: vec2<f32>, b: vec2<f32>, winding: f32) -> bool {
    if (value > 0.0) { return true; }
    if (value < 0.0) { return false; }
    let direction = (b - a) * winding;
    return direction.y > 0.0 || (direction.y == 0.0 && direction.x < 0.0);
}

// Half-open yz coverage counts shared triangle edges exactly once for the +X
// parity ray. No jitter can move that ray through a neighbouring thin surface.
fn rayTriangleHit(origin: vec3<f32>, tri: Triangle) -> bool {
    let a = tri.v0 - origin;
    let b = tri.v1 - origin;
    let c = tri.v2 - origin;
    let area = projectedEdge(b.yz - a.yz, c.yz - a.yz);
    if (area == 0.0) { return false; }
    let winding = select(-1.0, 1.0, area > 0.0);
    let wa = projectedEdge(b.yz, c.yz) * winding;
    let wb = projectedEdge(c.yz, a.yz) * winding;
    let wc = projectedEdge(a.yz, b.yz) * winding;
    if (!ownsProjectedEdge(wa, b.yz, c.yz, winding)
        || !ownsProjectedEdge(wb, c.yz, a.yz, winding)
        || !ownsProjectedEdge(wc, a.yz, b.yz, winding)) { return false; }
    return wa * a.x + wb * b.x + wc * c.x > 0.0;
}

// Count ray intersections to determine inside/outside
fn isInside(p: vec3<f32>) -> bool {
    var count: u32 = 0u;
    
    for (var i: u32 = 0u; i < params.triangleCount; i++) {
        if (rayTriangleHit(p, triangles[i])) {
            count++;
        }
    }
    
    return (count % 2u) == 1u;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = params.resolution;
    
    if (gid.x >= res || gid.y >= res || gid.z >= res) {
        return;
    }
    
    // Calculate world position for this voxel
    let voxelPos = vec3<f32>(
        params.boundsMin.x + (f32(gid.x) + 0.5) / f32(res) * params.size.x,
        params.boundsMin.y + (f32(gid.y) + 0.5) / f32(res) * params.size.y,
        params.boundsMin.z + (f32(gid.z) + 0.5) / f32(res) * params.size.z
    );
    
    // Find minimum distance to all triangles
    var minDist: f32 = 1e10;
    for (var i: u32 = 0u; i < params.triangleCount; i++) {
        let d = pointToTriangleDist(voxelPos, triangles[i]);
        minDist = min(minDist, d);
    }
    
    // Determine sign (inside = negative)
    let inside = isInside(voxelPos);
    let signedDist = select(minDist, -minDist, inside);
    
    // Write to output buffer
    let idx = gid.x + gid.y * res + gid.z * res * res;
    sdfOutput[idx] = signedDist;
}
`;

/**
 * GPU-accelerated SDF baker
 */
export class SDFBakeCompute {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.initialized = false;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        const shaderModule = this.vgpu.shader.compile('sdfBake', SDF_BAKE_SHADER);
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('sdfBake', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'read-storage', visibility: 'compute' },
            { binding: 2, type: 'storage', visibility: 'compute' },
        ]);
        
        this.pipeline = this.vgpu.pipeline.compute({
            module: shaderModule,
            entryPoint: 'main',
            layouts: [this.bindGroupLayout],
            label: 'SDFBakeCompute'
        });
        
        this.initialized = true;
    }
    
    /**
     * Bake SDF texture on GPU
     * @param {Float32Array} positions - Mesh vertex positions
     * @param {Uint32Array|Uint16Array} indices - Triangle indices
     * @param {number} resolution - SDF resolution (e.g., 32, 64, 128)
     * @param {object} bounds - { min: [x,y,z], max: [x,y,z] }
     * @returns {Promise<Float32Array>} SDF data
     */
    async bake(positions, indices, resolution, bounds) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        const triangleCount = indices.length / 3;
        
        // Prepare triangle buffer (48 bytes per triangle: 3 vec4s)
        const triangleData = new Float32Array(triangleCount * 12);
        for (let i = 0; i < triangleCount; i++) {
            const i0 = indices[i * 3] * 3;
            const i1 = indices[i * 3 + 1] * 3;
            const i2 = indices[i * 3 + 2] * 3;
            
            const offset = i * 12;
            triangleData[offset + 0] = positions[i0];
            triangleData[offset + 1] = positions[i0 + 1];
            triangleData[offset + 2] = positions[i0 + 2];
            triangleData[offset + 3] = 0; // padding
            
            triangleData[offset + 4] = positions[i1];
            triangleData[offset + 5] = positions[i1 + 1];
            triangleData[offset + 6] = positions[i1 + 2];
            triangleData[offset + 7] = 0;
            
            triangleData[offset + 8] = positions[i2];
            triangleData[offset + 9] = positions[i2 + 1];
            triangleData[offset + 10] = positions[i2 + 2];
            triangleData[offset + 11] = 0;
        }
        
        // Params buffer (64 bytes, aligned)
        const size = [
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2]
        ];
        
        const paramsData = new ArrayBuffer(64);
        const paramsView = new DataView(paramsData);
        paramsView.setUint32(0, resolution, true);
        paramsView.setUint32(4, triangleCount, true);
        paramsView.setUint32(8, 0, true); // padding
        paramsView.setUint32(12, 0, true);
        paramsView.setFloat32(16, bounds.min[0], true);
        paramsView.setFloat32(20, bounds.min[1], true);
        paramsView.setFloat32(24, bounds.min[2], true);
        paramsView.setFloat32(28, 0, true); // padding
        paramsView.setFloat32(32, bounds.max[0], true);
        paramsView.setFloat32(36, bounds.max[1], true);
        paramsView.setFloat32(40, bounds.max[2], true);
        paramsView.setFloat32(44, 0, true);
        paramsView.setFloat32(48, size[0], true);
        paramsView.setFloat32(52, size[1], true);
        paramsView.setFloat32(56, size[2], true);
        paramsView.setFloat32(60, 0, true);
        
        // Create buffers using vGPU
        const paramsBuffer = this.vgpu.buffer.create({ size: 64, usage: 'uniform', data: new Float32Array(paramsData), label: 'SDFBakeParams' }).buffer;
        const triangleBuffer = this.vgpu.buffer.create({ size: triangleData.byteLength, usage: 'storage', data: triangleData, label: 'SDFTriangles' }).buffer;
        
        const outputSize = resolution * resolution * resolution * 4;
        const outputBuffer = this.vgpu.buffer.create({ size: outputSize, usage: 'storage|copy-src', label: 'SDFOutput' }).buffer;
        const readbackBuffer = this.vgpu.buffer.create({ size: outputSize, usage: 'map-read|copy-dst', label: 'SDFReadback' }).buffer;
        
        // Create bind group using vGPU
        const bindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: paramsBuffer },
            { binding: 1, buffer: triangleBuffer },
            { binding: 2, buffer: outputBuffer },
        ], 'SDFBakeBindGroup');
        
        // Dispatch compute
        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, bindGroup);
        
        // Workgroups of 4x4x4, so divide resolution by 4
        const workgroups = Math.ceil(resolution / 4);
        computePass.dispatchWorkgroups(workgroups, workgroups, workgroups);
        computePass.end();
        
        // Copy output to readback buffer
        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, outputSize);
        
        this.device.queue.submit([commandEncoder.finish()]);
        
        // Read back results
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(readbackBuffer.getMappedRange().slice(0));
        readbackBuffer.unmap();
        
        // Cleanup
        paramsBuffer.destroy();
        triangleBuffer.destroy();
        outputBuffer.destroy();
        readbackBuffer.destroy();
        
        return resultData;
    }
}

/**
 * Create GPU SDF baker instance
 */
export function createSDFBaker(device) {
    return new SDFBakeCompute(device);
}
