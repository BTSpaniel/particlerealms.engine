/**
 * GPUMeshDeform.js — GPU-accelerated vertex displacement for impact dents
 *
 * Fast-path for small impacts: pushes vertices inward within a radius
 * around the impact point, weighted by distance. Runs in <1ms on GPU
 * vs 50-200ms for the full voxelize→SDF→marching cubes CPU pipeline.
 *
 * Also includes a normal recalculation pass (GAP 4).
 *
 * Usage:
 *   const deformer = new GPUMeshDeform(device);
 *   const result = await deformer.applyDent(positions, indices, {
 *       impactPoint: [x, y, z],
 *       impactNormal: [nx, ny, nz],
 *       radius: 0.3,
 *       depth: 0.1,
 *   });
 *   // result.positions — Float32Array of deformed positions
 *   // result.normals   — Float32Array of recalculated normals
 */

// ============================================================================
// WGSL SHADERS
// ============================================================================

const DENT_SHADER = /* wgsl */`
struct Params {
    impactX: f32,
    impactY: f32,
    impactZ: f32,
    radius: f32,
    normalX: f32,
    normalY: f32,
    normalZ: f32,
    depth: f32,
    vertexCount: u32,
    falloffPower: f32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> positions: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.vertexCount) {
        return;
    }

    let base = idx * 3u;
    let px = positions[base];
    let py = positions[base + 1u];
    let pz = positions[base + 2u];

    // Distance from impact point
    let dx = px - params.impactX;
    let dy = py - params.impactY;
    let dz = pz - params.impactZ;
    let dist = sqrt(dx * dx + dy * dy + dz * dz);

    // Skip vertices outside radius
    if (dist >= params.radius) {
        return;
    }

    // Smooth falloff: 1 at center, 0 at edge
    let t = dist / params.radius;
    let falloff = pow(1.0 - t, params.falloffPower);

    // Displacement along impact normal (push inward)
    let displacement = params.depth * falloff;
    positions[base]      = px + params.normalX * displacement;
    positions[base + 1u] = py + params.normalY * displacement;
    positions[base + 2u] = pz + params.normalZ * displacement;
}
`;

// GAP 4: Normal recalculation compute shader
const NORMAL_RECALC_SHADER = /* wgsl */`
struct Params {
    vertexCount: u32,
    triangleCount: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> normals: array<atomic<i32>>;

// Accumulate face normals into vertex normals using atomics (fixed-point)
// Scale factor for fixed-point atomic accumulation
const FP_SCALE: f32 = 65536.0;

@compute @workgroup_size(64)
fn accumulateFaceNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
    let triIdx = gid.x;
    if (triIdx >= params.triangleCount) {
        return;
    }

    let i0 = indices[triIdx * 3u];
    let i1 = indices[triIdx * 3u + 1u];
    let i2 = indices[triIdx * 3u + 2u];

    // Load positions
    let ax = positions[i0 * 3u]; let ay = positions[i0 * 3u + 1u]; let az = positions[i0 * 3u + 2u];
    let bx = positions[i1 * 3u]; let by = positions[i1 * 3u + 1u]; let bz = positions[i1 * 3u + 2u];
    let cx = positions[i2 * 3u]; let cy = positions[i2 * 3u + 1u]; let cz = positions[i2 * 3u + 2u];

    // Edge vectors
    let e1x = bx - ax; let e1y = by - ay; let e1z = bz - az;
    let e2x = cx - ax; let e2y = cy - ay; let e2z = cz - az;

    // Cross product (area-weighted normal)
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;

    // Fixed-point accumulate to each vertex
    let fnx = i32(nx * FP_SCALE);
    let fny = i32(ny * FP_SCALE);
    let fnz = i32(nz * FP_SCALE);

    atomicAdd(&normals[i0 * 3u],      fnx);
    atomicAdd(&normals[i0 * 3u + 1u], fny);
    atomicAdd(&normals[i0 * 3u + 2u], fnz);

    atomicAdd(&normals[i1 * 3u],      fnx);
    atomicAdd(&normals[i1 * 3u + 1u], fny);
    atomicAdd(&normals[i1 * 3u + 2u], fnz);

    atomicAdd(&normals[i2 * 3u],      fnx);
    atomicAdd(&normals[i2 * 3u + 1u], fny);
    atomicAdd(&normals[i2 * 3u + 2u], fnz);
}

@compute @workgroup_size(64)
fn normalizeNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.vertexCount) {
        return;
    }

    let base = idx * 3u;
    let nx = f32(atomicLoad(&normals[base])) / FP_SCALE;
    let ny = f32(atomicLoad(&normals[base + 1u])) / FP_SCALE;
    let nz = f32(atomicLoad(&normals[base + 2u])) / FP_SCALE;

    let len = sqrt(nx * nx + ny * ny + nz * nz);
    let invLen = select(1.0, 1.0 / len, len > 0.0001);

    // Write normalized result back (reinterpret i32 storage as f32 bits)
    atomicStore(&normals[base],      bitcast<i32>(nx * invLen));
    atomicStore(&normals[base + 1u], bitcast<i32>(ny * invLen));
    atomicStore(&normals[base + 2u], bitcast<i32>(nz * invLen));
}
`;

// ============================================================================
// GPU MESH DEFORM CLASS
// ============================================================================

export class GPUMeshDeform {
    constructor(device) {
        this.device = device;
        this._dentPipeline = null;
        this._normalAccumPipeline = null;
        this._normalNormPipeline = null;
        this._ready = false;
    }

    async init() {
        if (this._ready || !this.device) return;
        const device = this.device;

        // Dent pipeline
        const dentModule = device.createShaderModule({ code: DENT_SHADER });
        this._dentPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: dentModule, entryPoint: 'main' },
        });

        // Normal recalc pipelines
        const normModule = device.createShaderModule({ code: NORMAL_RECALC_SHADER });
        this._normalAccumPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: normModule, entryPoint: 'accumulateFaceNormals' },
        });
        this._normalNormPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: normModule, entryPoint: 'normalizeNormals' },
        });

        this._ready = true;
    }

    /**
     * Apply a dent to mesh vertices and recalculate normals on GPU.
     *
     * @param {Float32Array} positions - Vertex positions (stride 3)
     * @param {Uint32Array|Uint16Array} indices - Triangle indices (stride 3)
     * @param {Object} opts
     * @param {number[]} opts.impactPoint  - [x,y,z] world-space impact
     * @param {number[]} opts.impactNormal - [nx,ny,nz] inward push direction
     * @param {number}   opts.radius       - Dent radius in world units
     * @param {number}   opts.depth        - Maximum dent depth (negative = push inward)
     * @param {number}   [opts.falloffPower=2] - Falloff curve exponent
     * @returns {Promise<{positions: Float32Array, normals: Float32Array}>}
     */
    async applyDent(positions, indices, opts) {
        if (!this._ready) await this.init();
        if (!this._ready) return null;

        const device = this.device;
        const vertexCount = (positions.length / 3) | 0;
        const triangleCount = (indices.length / 3) | 0;
        const depth = opts.depth ?? -0.1;
        const falloffPower = opts.falloffPower ?? 2.0;

        // Ensure Uint32 indices for GPU
        const idx32 = indices instanceof Uint32Array ? indices : new Uint32Array(indices);

        // ---- DENT PASS ----

        // Params uniform
        const dentParams = new Float32Array([
            opts.impactPoint[0], opts.impactPoint[1], opts.impactPoint[2], opts.radius,
            opts.impactNormal[0], opts.impactNormal[1], opts.impactNormal[2], depth,
        ]);
        const dentParamsU32 = new Uint32Array([vertexCount]);
        const dentParamsF32b = new Float32Array([falloffPower]);
        // Pack into 48 bytes (12 x f32 aligned to 16-byte struct)
        const dentParamsBuf = device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const dentParamData = new ArrayBuffer(48);
        new Float32Array(dentParamData, 0, 8).set(dentParams);
        new Uint32Array(dentParamData, 32, 1).set(dentParamsU32);
        new Float32Array(dentParamData, 36, 1).set(dentParamsF32b);
        device.queue.writeBuffer(dentParamsBuf, 0, dentParamData);

        // Position buffer (read-write)
        const posBuf = device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(posBuf, 0, positions);

        // Dent dispatch
        const dentBG = device.createBindGroup({
            layout: this._dentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: dentParamsBuf } },
                { binding: 1, resource: { buffer: posBuf } },
            ],
        });

        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this._dentPipeline);
        pass.setBindGroup(0, dentBG);
        pass.dispatchWorkgroups(Math.ceil(vertexCount / 64));
        pass.end();

        // ---- NORMAL RECALC PASS ----

        // Normal params uniform
        const normParamsBuf = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(normParamsBuf, 0, new Uint32Array([vertexCount, triangleCount, 0, 0]));

        // Index buffer
        const idxBuf = device.createBuffer({
            size: idx32.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(idxBuf, 0, idx32);

        // Normal buffer (atomic i32, zeroed)
        const normBuf = device.createBuffer({
            size: vertexCount * 3 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Accumulate face normals
        const accumBG = device.createBindGroup({
            layout: this._normalAccumPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: normParamsBuf } },
                { binding: 1, resource: { buffer: posBuf } },
                { binding: 2, resource: { buffer: idxBuf } },
                { binding: 3, resource: { buffer: normBuf } },
            ],
        });

        const pass2 = enc.beginComputePass();
        pass2.setPipeline(this._normalAccumPipeline);
        pass2.setBindGroup(0, accumBG);
        pass2.dispatchWorkgroups(Math.ceil(triangleCount / 64));
        pass2.end();

        // Normalize normals
        const normBG = device.createBindGroup({
            layout: this._normalNormPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: normParamsBuf } },
                { binding: 1, resource: { buffer: posBuf } },
                { binding: 2, resource: { buffer: idxBuf } },
                { binding: 3, resource: { buffer: normBuf } },
            ],
        });

        const pass3 = enc.beginComputePass();
        pass3.setPipeline(this._normalNormPipeline);
        pass3.setBindGroup(0, normBG);
        pass3.dispatchWorkgroups(Math.ceil(vertexCount / 64));
        pass3.end();

        // Readback buffers
        const posReadBuf = device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const normReadBuf = device.createBuffer({
            size: vertexCount * 3 * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        enc.copyBufferToBuffer(posBuf, 0, posReadBuf, 0, positions.byteLength);
        enc.copyBufferToBuffer(normBuf, 0, normReadBuf, 0, vertexCount * 3 * 4);

        device.queue.submit([enc.finish()]);

        // Map and read results
        await posReadBuf.mapAsync(GPUMapMode.READ);
        await normReadBuf.mapAsync(GPUMapMode.READ);

        const resultPos = new Float32Array(posReadBuf.getMappedRange().slice(0));
        // Normal buffer contains bitcast<i32>(f32) after normalize pass — read as f32
        const resultNorm = new Float32Array(normReadBuf.getMappedRange().slice(0));

        posReadBuf.unmap();
        normReadBuf.unmap();

        // Cleanup
        dentParamsBuf.destroy();
        posBuf.destroy();
        idxBuf.destroy();
        normBuf.destroy();
        normParamsBuf.destroy();
        posReadBuf.destroy();
        normReadBuf.destroy();

        return { positions: resultPos, normals: resultNorm };
    }

    destroy() {
        this._dentPipeline = null;
        this._normalAccumPipeline = null;
        this._normalNormPipeline = null;
        this._ready = false;
    }
}
