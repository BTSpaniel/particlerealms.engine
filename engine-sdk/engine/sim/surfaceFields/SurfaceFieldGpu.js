// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createCheckedShaderModule, assertCheckedShaderModule } from '../../core/gpu/GpuShaderDiagnostics.js';
import { createSurfaceFieldMotion } from './SurfaceFieldMotion.js';

/** Conservative phase-volume transport. Reactions remain owned by the native
 * material/combustion model; the other seven fields pass through bit-for-bit.
 * A directed flux is capped by the donor's volume before the gather pass.
 */
export const SURFACE_WATER_WGSL = /* wgsl */`
struct Cell { a:vec4f, b:vec4f }
struct Parameters { count:u32, dt:f32, rain:f32, flow:f32, tilt:vec2f, padding:vec2f }
@group(0) @binding(0) var<uniform> p:Parameters;
@group(0) @binding(1) var<storage,read> source:array<Cell>;
@group(0) @binding(2) var<storage,read_write> destination:array<Cell>;
// metadata: support, area, local x/z; rain exposure, tiltable, up.y, moving.
@group(0) @binding(3) var<storage,read> metadata:array<Cell>;
@group(0) @binding(4) var<storage,read> neighbors:array<u32>;
@group(0) @binding(5) var<storage,read> offsets:array<vec2u>;
@group(0) @binding(6) var<storage,read> incoming:array<u32>;
@group(0) @binding(7) var<storage,read_write> flux:array<f32>;
@group(0) @binding(8) var<storage,read> headOffsets:array<f32>;
fn support(i:u32)->f32 {let m=metadata[i];return m.a.x+dot(p.tilt,m.a.zw)*m.b.y;}
fn water(i:u32)->f32 {return source[i].a.x+p.rain*p.dt*metadata[i].b.x;}
fn head(i:u32)->f32 {
 if(metadata[i].b.w>0.0){return support(i)+(headOffsets[i]+water(i))*metadata[i].b.z;}
 return support(i)+headOffsets[i]+water(i);
}
@compute @workgroup_size(64) fn surfaceFlux(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x;if(i>=p.count){return;}
 let base=support(i);let pressure=head(i);var candidate:array<f32,4>;var total=0.0;
 for(var k=0u;k<4u;k++) {
  let j=neighbors[i*4u+k];var downstream=base-0.2;
  if(metadata[i].b.w>0.0 && metadata[i].b.z<0.0){downstream=pressure-0.2;}
  if(j!=0xffffffffu){downstream=head(j);}
  candidate[k]=max(0.0,pressure-downstream)*0.025*p.dt*p.flow;total+=candidate[k];
 }
 let available=water(i)*metadata[i].a.y;let scale=min(1.0,available/max(total,1e-12));
 for(var k=0u;k<4u;k++){flux[i*4u+k]=candidate[k]*scale;}
}
@compute @workgroup_size(64) fn surfaceGather(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x;if(i>=p.count){return;}var outward=0.0;var inward=0.0;
 for(var k=0u;k<4u;k++){outward+=flux[i*4u+k];}
 let range=offsets[i];for(var k=0u;k<range.y;k++){let edge=incoming[range.x+k];if(neighbors[edge]==i){inward+=flux[edge];}}
 var cell=source[i];cell.a.x=max(0.0,water(i)+(inward-outward)/metadata[i].a.y);destination[i]=cell;
}
`;

/** A borrowed-device runtime. Call ticket.submitted() immediately after the
 * caller submits an encoder, or use step(), which owns its own submission.
 * Immutable, mapped uniform slices make differing batched parameters safe.
 */
export async function createSurfaceFieldGpuRuntime(options) {
    const runtime = new SurfaceFieldGpuRuntime(options);
    try { await runtime.initialize(); return runtime; }
    catch (error) { runtime.log('error', 'initialization failed', { message: error.message }); runtime.dispose(); throw error; }
}

class SurfaceFieldGpuRuntime {
    constructor({ device, topology, logger } = {}) {
        if (!device?.createBuffer || !topology?.count || !Array.isArray(topology.domains)) throw new TypeError('Surface GPU runtime needs a device and topology');
        this.device = device; this.topology = topology; this.logger = logger;
        this.resources = new Set(); this.transient = new Set(); this.disposed = false; this.index = 0;
        this._bytes = 0; this.pendingRead = null; this.pendingTransport = false; this.encoderBatches = new WeakMap(); this.steps = 0;
    }
    log(level, message, detail = {}) {
        if (typeof this.logger === 'function') this.logger(`[SurfaceFieldGpu] ${message}`, { level, ...detail });
        else this.logger?.[level]?.(`[SurfaceFieldGpu] ${message}`, detail);
    }
    get bytes() { return this._bytes; }
    alive() { if (this.disposed) throw new Error('Surface GPU runtime is disposed'); }
    buffer(data, label, usage) {
        const length = typeof data === 'number' ? data : data.byteLength;
        const size = Math.max(16, Math.ceil(length / 4) * 4);
        if (size > this.device.limits.maxBufferSize) throw new RangeError(`${label} exceeds the GPU buffer limit`);
        const buffer = this.device.createBuffer({ label: `Surface ${label}`, size, usage, mappedAtCreation: typeof data !== 'number' });
        this.resources.add(buffer); this._bytes += size;
        if (typeof data !== 'number') { new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer.unmap(); }
        return buffer;
    }
    release(buffer) {
        if (!this.resources.delete(buffer)) return;
        this.transient.delete(buffer); this._bytes -= buffer.size; buffer.destroy();
    }
    async initialize() {
        this.log('debug', 'initializing water transport', { cells: this.topology.count });
        const t = this.topology, device = this.device, storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        const meta = new Float32Array(t.count * 8);
        for (let i = 0; i < t.count; i++) {
            const m = i * 8, d = t.domains[t.meta[m + 4]];
            meta.set([t.meta[m + 1], t.meta[m + 3], t.meta[m] - d.center[0], t.meta[m + 2] - d.center[2], t.meta[m + 5], Number(!d.receiveRunoff && d.material !== 'calcite'), 0, 0], m);
        }
        this.fields = [this.buffer(t.count * 32, 'water state A', storage), this.buffer(t.count * 32, 'water state B', storage)];
        this.staticMeta = meta; this.motion = null;
        this.meta = this.buffer(meta, 'water metric geometry', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.neighbors = this.buffer(t.neighbors, 'directed neighbors', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.offsets = this.buffer(t.offsets, 'incoming ranges', GPUBufferUsage.STORAGE);
        this.incoming = this.buffer(t.incoming, 'incoming edges', GPUBufferUsage.STORAGE);
        this.flux = this.buffer(t.count * 16, 'bounded volume flux', storage);
        this.headOffsets = this.buffer(new Float32Array(t.count), 'retained liquid pressure head', storage);
        this.readBuffer = this.buffer(t.count * 48, 'water and volume-flux readback', GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        this.layout = device.createBindGroupLayout({ entries: Array.from({ length: 9 }, (_, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: binding === 0 ? 'uniform' : [2, 7].includes(binding) ? 'storage' : 'read-only-storage' } })) });
        const module = createCheckedShaderModule(device, { label: 'Surface conservative water transport', code: SURFACE_WATER_WGSL });
        await assertCheckedShaderModule(module);
        const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
        const pipelines = await Promise.all(['surfaceFlux', 'surfaceGather'].map(entryPoint => device.createComputePipelineAsync({ label: `Surface ${entryPoint}`, layout, compute: { module, entryPoint } })));
        this.pipelines = pipelines; this.log('debug', 'water transport ready', { bytes: this.bytes });
    }
    upload(fields, { headOffsets = null, motion = null } = {}) {
        this.alive();
        if (!(fields instanceof Float32Array) || fields.length !== this.topology.count * 8 || fields.some(value => !Number.isFinite(value)) || fields.some((value, index) => index % 8 === 0 && value < 0)) throw new RangeError('Surface water upload requires finite fields and nonnegative water');
        if (headOffsets !== null && (!(headOffsets instanceof Float32Array) || headOffsets.length !== this.topology.count || headOffsets.some(value => !Number.isFinite(value)))) throw new RangeError('Surface pressure head requires one finite value per cell');
        const candidate = motion === null ? null : createSurfaceFieldMotion(this.topology, motion);
        if (candidate || this.motion) {
            const meta = this.staticMeta.slice();
            if (candidate) for (let i = 0; i < this.topology.count; i++) {
                meta[i * 8] = candidate.heights[i]; meta[i * 8 + 5] = 0;
                meta[i * 8 + 6] = candidate.normalUp[i]; meta[i * 8 + 7] = 1;
            }
            this.device.queue.writeBuffer(this.meta, 0, meta);
            this.device.queue.writeBuffer(this.neighbors, 0, candidate?.neighbors ?? this.topology.neighbors);
        }
        this.motion = candidate;
        this.device.queue.writeBuffer(this.fields[this.index], 0, fields);
        this.device.queue.writeBuffer(this.headOffsets, 0, headOffsets ?? new Float32Array(this.topology.count));
    }
    getBuffer() { this.alive(); return this.fields[this.index]; }
    encode(encoder, parameters) { return this.encodeBatch(encoder, [parameters]); }
    encodeBatch(encoder, steps) {
        this.alive();
        if (!encoder?.beginComputePass || !Array.isArray(steps) || !steps.length || steps.length > 4) throw new RangeError('Surface water batch needs one through four steps and a command encoder');
        const previous = this.encoderBatches.get(encoder) || 0;
        if (previous + steps.length > 4) throw new RangeError('At most four surface water steps may share one encoder');
        const stride = Math.max(256, this.device.limits.minUniformBufferOffsetAlignment);
        const parameters = new ArrayBuffer(stride * steps.length);
        steps.forEach((input, slot) => {
            const { dt, rain = 0, flow = 1, tiltX = 0, tiltZ = 0 } = input || {};
            if (![dt, rain, flow, tiltX, tiltZ].every(Number.isFinite) || dt <= 0 || dt > 1 || rain < 0 || flow < 0 || flow > 100 || Math.abs(tiltX) > 10 || Math.abs(tiltZ) > 10) throw new RangeError('Invalid surface water step parameters');
            new Uint32Array(parameters, slot * stride, 1)[0] = this.topology.count;
            new Float32Array(parameters, slot * stride + 4, 7).set([dt, rain, flow, tiltX, tiltZ, 0, 0]);
        });
        const uniforms = this.buffer(new Uint8Array(parameters), 'immutable step parameters', GPUBufferUsage.UNIFORM);
        this.transient.add(uniforms); this.encoderBatches.set(encoder, previous + steps.length);
        for (let slot = 0; slot < steps.length; slot++) {
            const buffers = [null, this.fields[this.index], this.fields[1 - this.index], this.meta, this.neighbors, this.offsets, this.incoming, this.flux, this.headOffsets];
            const bind = this.device.createBindGroup({ layout: this.layout, entries: buffers.map((buffer, binding) => ({ binding, resource: binding ? { buffer } : { buffer: uniforms, offset: slot * stride, size: 32 } })) });
            for (const pipeline of this.pipelines) {
                const pass = encoder.beginComputePass({ label: 'Surface bounded water transport' });
                pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(this.topology.count / 64)); pass.end();
            }
            this.index = 1 - this.index; this.steps++;
        }
        let submitted = false;
        return { submitted: () => {
            if (submitted) return; submitted = true;
            this.device.queue.onSubmittedWorkDone().then(() => this.release(uniforms), () => this.release(uniforms));
        } };
    }
    step(parameters) {
        const encoder = this.device.createCommandEncoder({ label: 'Surface water step' });
        const ticket = this.encode(encoder, parameters); this.device.queue.submit([encoder.finish()]); ticket.submitted();
    }
    /** One serial phase request, with compute and readback copies in a single
     * submission. Rain is already admitted into the prepared aqueous input. */
    async transport({ fields, headOffsets = null, motion = null, phase = 'aqueous', ...parameters } = {}) {
        this.alive();
        if (this.pendingRead || this.pendingTransport) throw new Error('Await the preceding surface GPU transport');
        if (!['aqueous', 'oil'].includes(phase)) throw new RangeError('Invalid surface transport phase');
        this.pendingTransport = true;
        try {
            this.upload(fields, { headOffsets, motion });
            const encoder = this.device.createCommandEncoder({ label: `Surface ${phase} transport and readback` });
            const ticket = this.encode(encoder, parameters);
            return await this._readWaterResult(encoder, ticket);
        } finally { this.pendingTransport = false; }
    }
    async readWaterResult() {
        this.alive(); if (this.pendingRead) return this.pendingRead;
        return this._readWaterResult(this.device.createCommandEncoder({ label: 'Surface water state snapshot' }));
    }
    async _readWaterResult(encoder, ticket = null) {
        const neighbors = this.motion?.neighbors ?? this.topology.neighbors;
        this.pendingRead = (async () => {
            encoder.copyBufferToBuffer(this.getBuffer(), 0, this.readBuffer, 0, this.topology.count * 32);
            encoder.copyBufferToBuffer(this.flux, 0, this.readBuffer, this.topology.count * 32, this.topology.count * 16);
            this.device.queue.submit([encoder.finish()]); ticket?.submitted(); await this.readBuffer.mapAsync(GPUMapMode.READ);
            let snapshot;
            try { this.alive(); snapshot = new Float32Array(this.readBuffer.getMappedRange().slice(0)); }
            finally { if (!this.disposed) this.readBuffer.unmap(); }
            const fields = snapshot.slice(0, this.topology.count * 8), flux = snapshot.slice(this.topology.count * 8);
            let outflowM3 = 0;
            for (let edge = 0; edge < flux.length; edge++) if (neighbors[edge] === 0xffffffff) outflowM3 += flux[edge];
            if (this.steps % 120 === 0) this.log('debug', 'water snapshot complete', { steps: this.steps }); return { fields, flux, outflowM3 };
        })();
        try { return await this.pendingRead; } finally { this.pendingRead = null; }
    }
    async readback() { return (await this.readWaterResult()).fields; }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        for (const buffer of [...this.resources]) this.release(buffer);
        this.log('debug', 'disposed water transport');
    }
}
