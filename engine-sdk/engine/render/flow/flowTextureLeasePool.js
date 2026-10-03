// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { textureDescriptorByteSize } from '../../core/math/TextureMath.js';

const FORMATS = new Set(['rgba32float', 'rg32float', 'r32float']);

/** Bounded physical texture leases for the installed single-owner native host.
 * Returned resources remain real GPUTextures. The host must release each lease
 * once and discard its views before reacquiring that allocation. Idle contents
 * are explicitly zeroed through the caller's ordered encoder before reuse;
 * native fields never inherit an earlier lease's contents. */
export class FlowTextureLeasePool {
    constructor(device, { maxIdleBytes = 192 * 1024 * 1024, minTextureBytes = 32 * 1024 * 1024,
        maxTexturesPerDescriptor = 4, retirementFence } = {}) {
        if (!device?.queue || typeof retirementFence !== 'function') throw new TypeError('Flow texture leases require a device and retirement fence');
        if (![maxIdleBytes, minTextureBytes].every(value => Number.isSafeInteger(value) && value >= 0)
            || !Number.isSafeInteger(maxTexturesPerDescriptor) || maxTexturesPerDescriptor < 1)
            throw new RangeError('Invalid Flow texture lease bounds');
        this.device = device; this.retirementFence = retirementFence;
        this.maxIdleBytes = maxIdleBytes; this.minTextureBytes = minTextureBytes;
        this.maxTexturesPerDescriptor = maxTexturesPerDescriptor;
        this._idle = new Map(); this._records = new Set(); this._clears = new Set(); this._retirements = new Set();
        this._pipelines = new Map(); this._preparing = null; this._closed = false;
        this._stats = { allocations: 0, reuses: 0, bypasses: 0, releases: 0, destroyed: 0,
            clearPasses: 0, clearedBytes: 0, liveBytes: 0, idleBytes: 0, retiringBytes: 0, residentBytes: 0,
            peakResidentBytes: 0, failure: null };
    }
    get stats() { return { ...this._stats, maxIdleBytes: this.maxIdleBytes, minTextureBytes: this.minTextureBytes,
        maxTexturesPerDescriptor: this.maxTexturesPerDescriptor, pendingClears: this._clears.size, closed: this._closed }; }
    get retainedBytes() { return this._stats.idleBytes + this._stats.retiringBytes; }
    get hasPendingClears() { return this._clears.size > 0; }
    prepare() {
        if (this._closed) throw new Error('Flow texture lease pool is closed');
        return this._preparing ??= Promise.all([...FORMATS].map(async format => {
            const module = this.device.createShaderModule({ label: `Flow lease zero ${format}`, code: `
                @group(0) @binding(0) var leaseAtlas:texture_storage_3d<${format},write>;
                @compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u) {
                    if(all(id<textureDimensions(leaseAtlas))) { textureStore(leaseAtlas,vec3i(id),vec4f(0)); }
                }` });
            const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
            if (errors.length) throw new Error(errors.map(message => `${format}:${message.lineNum}: ${message.message}`).join('\n'));
            const pipeline = await this.device.createComputePipelineAsync({ label: `Flow lease zero ${format}`,
                layout: 'auto', compute: { module, entryPoint: 'main' } });
            if (!this._closed) this._pipelines.set(format, pipeline);
        }));
    }
    _descriptor(input) {
        const size = input?.size;
        const extent = Array.isArray(size) || ArrayBuffer.isView(size)
            ? [size[0], size[1] ?? 1, size[2] ?? 1] : [size?.width, size?.height ?? 1, size?.depthOrArrayLayers ?? 1];
        const mipLevelCount = input?.mipLevelCount ?? 1, sampleCount = input?.sampleCount ?? 1;
        if (input?.dimension !== '3d' || !FORMATS.has(input.format) || sampleCount !== 1
            || !(input.usage & GPUTextureUsage.STORAGE_BINDING) || !(input.usage & GPUTextureUsage.COPY_DST)
            || !extent.every(value => Number.isSafeInteger(value) && value > 0)
            || !Number.isSafeInteger(mipLevelCount) || mipLevelCount < 1) return null;
        const descriptor = { ...input, size: extent, mipLevelCount, sampleCount, viewFormats: [...(input.viewFormats ?? [])] };
        const bytes = textureDescriptorByteSize(descriptor);
        if (!Number.isSafeInteger(bytes) || bytes < this.minTextureBytes || bytes > this.maxIdleBytes) return null;
        const key = JSON.stringify([descriptor.dimension, extent, descriptor.format, descriptor.usage,
            mipLevelCount, sampleCount, descriptor.viewFormats]);
        return { descriptor, bytes, key };
    }
    acquire(input, allowReuse = false) {
        if (this._closed) throw new Error('Flow texture lease pool is closed');
        const specification = this._descriptor(input);
        if (!specification) { ++this._stats.bypasses; return this.device.createTexture(input); }
        const available = this._idle.get(specification.key);
        let record = allowReuse ? available?.pop() : null;
        if (record) {
            if (!available.length) this._idle.delete(record.key);
            this._stats.idleBytes -= record.bytes; this._stats.liveBytes += record.bytes;
            record.state = 'live'; this._clears.add(record); ++this._stats.reuses;
            record.texture.label = input.label ?? '';
            return record.texture;
        }
        const texture = this.device.createTexture(specification.descriptor);
        const destroy = texture.destroy.bind(texture);
        record = { ...specification, texture, destroy, state: 'live', bindings: null };
        try { Object.defineProperty(texture, 'destroy', { configurable: true, value: () => this._release(record) }); }
        catch { ++this._stats.bypasses; return texture; }
        this._records.add(record); ++this._stats.allocations;
        this._stats.liveBytes += record.bytes; this._stats.residentBytes += record.bytes;
        this._stats.peakResidentBytes = Math.max(this._stats.peakResidentBytes, this._stats.residentBytes);
        return texture;
    }
    _release(record) {
        if (record.state !== 'live') return;
        ++this._stats.releases; this._stats.liveBytes -= record.bytes;
        this._stats.retiringBytes += record.bytes; record.state = 'retiring'; this._clears.delete(record);
        let fence;
        try { fence = this.retirementFence(); }
        catch (error) { fence = Promise.reject(error); }
        const operation = Promise.resolve(fence).then(() => {
            if (record.state !== 'retiring') return;
            const available = this._idle.get(record.key) ?? [];
            if (this._closed || available.length >= this.maxTexturesPerDescriptor
                || this._stats.idleBytes + record.bytes > this.maxIdleBytes) { this._destroy(record); return; }
            this._stats.retiringBytes -= record.bytes; this._stats.idleBytes += record.bytes;
            record.state = 'idle'; available.push(record); this._idle.set(record.key, available);
        }, error => {
            this._stats.failure = error.message; this._destroy(record);
        });
        this._retirements.add(operation);
        operation.finally(() => this._retirements.delete(operation)).catch(() => {});
    }
    /** Called before a native encoder operation; uses the same split/budget path. */
    encodePendingClears(encoder) {
        const pending = [...this._clears]; this._clears.clear();
        for (const record of pending) {
            if (record.state !== 'live') continue;
            const pipeline = this._pipelines.get(record.descriptor.format);
            if (!pipeline) throw new Error('Prepare Flow texture zero pipelines before reuse');
            record.bindings ??= Array.from({ length: record.descriptor.mipLevelCount }, (_, level) => {
                const view = record.texture.createView({ dimension: '3d', baseMipLevel: level, mipLevelCount: 1 });
                return this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] });
            });
            for (let level = 0; level < record.descriptor.mipLevelCount; ++level) {
                const pass = encoder.beginComputePass({ label: `Flow lease zero ${record.descriptor.format} mip ${level}` });
                pass.setPipeline(pipeline); pass.setBindGroup(0, record.bindings[level]);
                pass.dispatchWorkgroups(...record.descriptor.size.map(value => Math.ceil(Math.max(1, Math.floor(value / 2 ** level)) / 4)));
                pass.end(); ++this._stats.clearPasses;
            }
            this._stats.clearedBytes += record.bytes;
        }
    }
    _destroy(record) {
        if (record.state === 'destroyed') return;
        if (record.state === 'live') this._stats.liveBytes -= record.bytes;
        else if (record.state === 'idle') this._stats.idleBytes -= record.bytes;
        else if (record.state === 'retiring') this._stats.retiringBytes -= record.bytes;
        this._stats.residentBytes -= record.bytes; ++this._stats.destroyed;
        record.state = 'destroyed'; this._clears.delete(record); this._records.delete(record); record.destroy();
    }
    async dispose() {
        if (this._closed) return; this._closed = true;
        await Promise.allSettled([...this._retirements]);
        // Active leases still belong to the native owner. Restore real destroy
        // instead of invalidating borrowed resources if teardown order is wrong.
        for (const record of this._records) {
            if (record.state === 'live') {
                Object.defineProperty(record.texture, 'destroy', { configurable: true, value: record.destroy });
                this._stats.liveBytes -= record.bytes; this._stats.residentBytes -= record.bytes;
                record.state = 'detached';
            } else this._destroy(record);
        }
        this._records.clear(); this._idle.clear(); this._clears.clear(); this._pipelines.clear();
    }
}
