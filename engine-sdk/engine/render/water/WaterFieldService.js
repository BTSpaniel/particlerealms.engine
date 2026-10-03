// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createComplexFftPlan } from '../../core/gpu/ComplexFft.js';
import { createUniformBuffer, createStorageBuffer, destroyBuffers } from '../../core/gpu/GpuBuffer.js';
import { normalizeWaterFieldRecipe, WATER_FIELD_MAX_BYTES } from './WaterFieldRecipe.js';
import { createWaterFieldSeedData, waterFieldResourceByteSize, waterFieldQuality } from './WaterFieldMath.js';
import { WATER_FIELD_BINDING_ENTRIES, WATER_FIELD_EVOLVE_WGSL, WATER_FIELD_UNPACK_WGSL,
    WATER_FIELD_ANALYTIC_CACHE_WGSL, WATER_FIELD_MIP_WGSL } from './WaterFieldShaders.js';
import { createWaterInitializationDevice, writeWaterInitializationBuffer } from './WaterFieldInitialization.js';
export { createWaterInitializationDevice, writeWaterInitializationBuffer } from './WaterFieldInitialization.js';

const FIELD_NAMES = Object.freeze(['displacement', 'velocity', 'tangentX', 'tangentZ', 'slopeMoments']);

function finite(value, name, minimum = -1e6, maximum = 1e6) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`Water field ${name} must be finite in [${minimum}, ${maximum}].`);
    return value;
}

async function checkedPipeline(device, source, entryPoint, label) {
    const module = device.createShaderModule({ label, code: source });
    if (module.getCompilationInfo) {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(`${label}: ${errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('; ')}`);
    }
    const descriptor = { label, layout: 'auto', compute: { module, entryPoint } };
    return device.createComputePipelineAsync ? device.createComputePipelineAsync(descriptor) : device.createComputePipeline(descriptor);
}

/** A device-local field service. The caller exclusively owns acquisition,
 * time, command encoders, queue submission and submitted-resource lifetime. */
export class WaterFieldService {
    constructor({ device, recipe, maxBytes = WATER_FIELD_MAX_BYTES, label = 'WaterField', logger = null } = {}) {
        if (!device?.createTexture || !device?.createBuffer || !device?.queue?.writeBuffer) throw new TypeError('Water field requires an external GPUDevice.');
        finite(maxBytes, 'maxBytes', 1, WATER_FIELD_MAX_BYTES);
        this.device = device; this.recipe = normalizeWaterFieldRecipe(recipe); this.maxBytes = Math.floor(maxBytes); this.label = label;
        this.logger = typeof logger === 'function' ? logger : null;
        this.layout = device.createBindGroupLayout({ label: `${label}.sampleLayout`, entries: WATER_FIELD_BINDING_ENTRIES });
        const addressMode = this.recipe.model === 'analytic-cache-v2' ? 'clamp-to-edge' : 'repeat';
        this.sampler = device.createSampler({ label: `${label}.sampler`, magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: addressMode, addressModeV: addressMode });
        this._resources = new Set(); this._active = null; this._latest = null; this._reservedBytes = 0; this._disposed = false;
        this._preparation = Promise.resolve(); this._pipelines = null; this._encodeCount = 0; this._encoding = null;
    }

    _log(type, detail = {}) { this.logger?.({ type, module: 'WaterField', ...detail }); }
    _assertLive() { if (this._disposed) throw new Error('Water field service has been disposed.'); }
    get resourceBytes() { return Array.from(this._resources).reduce((sum, resource) => sum + resource.resourceBytes, 0) + this._reservedBytes; }

    async _preparePipelines() {
        if (!this._pipelines) {
            const spectral = this.recipe.model === 'spectral-wind-v2';
            this._pipelines = Promise.all([
                checkedPipeline(this.device, spectral ? `${this.recipe.sourceWGSL}\n${WATER_FIELD_EVOLVE_WGSL}` : `${WATER_FIELD_ANALYTIC_CACHE_WGSL}\n${this.recipe.sourceWGSL}`,
                    spectral ? 'waterFieldEvolve' : 'waterFieldCacheAnalytic', `${this.label}.${spectral ? 'evolve' : 'analytic'}`),
                spectral ? checkedPipeline(this.device, WATER_FIELD_UNPACK_WGSL, 'waterFieldUnpack', `${this.label}.unpack`) : null,
                checkedPipeline(this.device, WATER_FIELD_MIP_WGSL, 'waterFieldMip', `${this.label}.linearMomentsMip`),
            ]).then(([evolve, unpack, mip]) => ({ evolve, unpack, mip })).catch(error => { this._pipelines = null; throw error; });
        }
        return this._pipelines;
    }

    async _allocate(resolution) {
        const estimate = waterFieldResourceByteSize(resolution, this.recipe.model);
        if (this.resourceBytes + estimate.totalBytes > this.maxBytes) {
            this._log('water-field-budget-rejected', { residentBytes: this.resourceBytes, candidateBytes: estimate.totalBytes, maxBytes: this.maxBytes });
            throw new RangeError(`Water field candidate requires ${estimate.totalBytes} bytes with ${this.resourceBytes} resident; limit ${this.maxBytes}.`);
        }
        this._reservedBytes += estimate.totalBytes;
        const buffers = [], textures = [];
        let fft = null;
        try {
            const pipelines = await this._preparePipelines(); this._assertLive();
            const initializationDevice = createWaterInitializationDevice(this.device);
            const frameBuffer = createUniformBuffer(this.device, 64, { label: `${this.label}.frame` }); buffers.push(frameBuffer);
            const paramsBuffers = Array.from({ length: 3 }, (_, layer) => {
                const buffer = createUniformBuffer(this.device, 96, { label: `${this.label}.domain${layer}.params` }); buffers.push(buffer); return buffer;
            });
            const descriptor = { label: `${this.label}.linearFieldArrays`, size: { width: resolution, height: resolution, depthOrArrayLayers: 15 },
                dimension: '2d', format: 'rgba16float', mipLevelCount: estimate.mipLevels,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST };
            const texture = this.device.createTexture(descriptor); textures.push(texture);
            // Compatibility sampled-array views cover every parent layer.
            // Shared WGSL selects each field's three layers at fixed offsets.
            const sampleView = texture.createView({ label: `${this.label}.allFields`, dimension: '2d-array',
                baseMipLevel: 0, mipLevelCount: estimate.mipLevels });
            const views = FIELD_NAMES.map(() => sampleView);
            const baseStorageView = texture.createView({ label: `${this.label}.baseOutput`, dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1, arrayLayerCount: 15 });
            const mipScratch = this.device.createTexture({ label: `${this.label}.mipScratch`,
                size: { width: resolution / 2, height: resolution / 2, depthOrArrayLayers: 15 }, dimension: '2d', format: 'rgba16float',
                mipLevelCount: 1, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
            textures.push(mipScratch);
            const mipOutput = mipScratch.createView({ dimension: '2d-array' });
            const entries = [{ binding: 0, resource: { buffer: frameBuffer, offset: 0, size: 64 } }, { binding: 1, resource: this.sampler },
                ...views.map((view, index) => ({ binding: index + 2, resource: view }))];
            const bindGroup = this.device.createBindGroup({ label: `${this.label}.sampleBindings`, layout: this.layout, entries });
            let seed = { normalization: 0, heightSigma: this.recipe.parameters.significantWaveHeight / 4 }, seedBuffer = null;
            const domainGroups = [];
            if (this.recipe.model === 'spectral-wind-v2') {
                seed = createWaterFieldSeedData(this.recipe, resolution);
                seedBuffer = createStorageBuffer(initializationDevice, seed.data, { label: `${this.label}.seededGaussian` }); buffers.push(seedBuffer);
                delete seed.data;
                fft = createComplexFftPlan(initializationDevice, { size: resolution, dimensions: 2, batchCount: 6, inverse: true, label: `${this.label}.packedDomainsFFT` });
                const info = fft.pipelines.getCompilationInfo ? await fft.pipelines.getCompilationInfo() : null;
                const errors = info?.messages?.filter(message => message.type === 'error') ?? [];
                if (errors.length) throw new Error(`Water field FFT: ${errors.map(error => error.message).join('; ')}`);
                for (let layer = 0; layer < 3; layer++) {
                    const evolve = this.device.createBindGroup({ layout: pipelines.evolve.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: paramsBuffers[layer] } }, { binding: 1, resource: { buffer: seedBuffer } },
                        { binding: 2, resource: { buffer: fft.inputBuffer } }] });
                    const unpack = this.device.createBindGroup({ layout: pipelines.unpack.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: paramsBuffers[layer] } }, { binding: 1, resource: { buffer: fft.outputBuffer } },
                        { binding: 2, resource: baseStorageView }] });
                    domainGroups.push({ evolve, unpack });
                }
            } else {
                domainGroups.push({ evolve: this.device.createBindGroup({ layout: pipelines.evolve.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: paramsBuffers[0] } }, { binding: 2, resource: baseStorageView }] }) });
            }
            const mipPasses = [];
            for (let mip = 1; mip < estimate.mipLevels; mip++) {
                const extent = resolution >> mip;
                const paramsBuffer = createUniformBuffer(this.device, 32, { label: `${this.label}.mip${mip}.params` }); buffers.push(paramsBuffer);
                writeWaterInitializationBuffer(this.device, paramsBuffer, new Uint32Array([extent, extent, 15, 0, 0, 0, 0, 0]));
                const source = texture.createView({ dimension: '2d-array', baseMipLevel: mip - 1, mipLevelCount: 1 });
                const group = this.device.createBindGroup({ layout: pipelines.mip.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } }, { binding: 1, resource: source }, { binding: 2, resource: mipOutput }] });
                mipPasses.push({ group, extent, mip });
            }
            const actualBytes = estimate.textureBytes + buffers.reduce((sum, buffer) => sum + buffer.size, 0) + (fft?.resourceBytes ?? 0);
            if (actualBytes > estimate.totalBytes) throw new Error(`Water field accounting underestimated ${actualBytes - estimate.totalBytes} bytes.`);
            this._assertLive();
            const resource = { service: this, resolution, mipLevels: estimate.mipLevels, resourceBytes: actualBytes, buffers, textures, textureDescriptor: descriptor,
                views, entries, frameBuffer, bindGroup, layout: this.layout, pipelines, paramsBuffers, domainGroups, mipPasses, mipScratch, fft, seed, encoded: false, released: false, retiring: false, epoch: null };
            this._resources.add(resource); this._latest = resource;
            this._log('water-field-prepared', { resolution, resourceBytes: actualBytes, sourceHash: this.recipe.sourceHash, model: this.recipe.model });
            return resource;
        } catch (error) {
            fft?.dispose(); destroyBuffers(buffers); textures.forEach(texture => texture.destroy());
            this._log('water-field-prepare-failed', { resolution, error: error.message }); throw error;
        } finally { this._reservedBytes -= estimate.totalBytes; }
    }

    /** Allocate/check a candidate once. No adapter requests or submissions. */
    prepare(options = {}) {
        this._assertLive();
        const operation = this._preparation.then(async () => {
            this._assertLive(); const quality = waterFieldQuality(options.qualityDecision, options.resolution);
            let resource = Array.from(this._resources).find(value => !value.released && !value.retiring && value.resolution === quality.resolution);
            if (!resource) resource = await this._allocate(quality.resolution);
            return this._snapshot(resource, options, quality);
        });
        this._preparation = operation.catch(() => {});
        return operation;
    }

    _snapshot(resource, options, quality = waterFieldQuality(options.qualityDecision, resource.resolution)) {
        if (resource.retiring || resource.released || resource.service !== this) throw new Error('Water field resource is not available for a new frame.');
        const time = finite(options.time ?? resource.epoch?.time ?? 0, 'host time');
        const origin = options.origin ?? resource.epoch?.origin ?? [0, 0];
        if ((!Array.isArray(origin) && !ArrayBuffer.isView(origin)) || origin.length !== 2) throw new TypeError('Water field origin requires two coordinates.');
        const heightScale = finite(options.heightScale ?? resource.epoch?.heightScale ?? 1, 'heightScale', 0, 8), choppiness = finite(options.choppiness ?? resource.epoch?.choppiness ?? 1, 'choppiness gain', 0, 4);
        return Object.freeze({ service: this, resource, time, origin: Object.freeze([finite(origin[0], 'originX'), finite(origin[1], 'originZ')]),
            heightScale, choppiness, quality, update: options.update !== false });
    }

    /** Synchronous frame preparation after first allocation. The host queue
     * coordinator can call this from its existing synchronous encode callback. */
    prepareFrame(options = {}) {
        this._assertLive(); const resource = options.prepared?.resource ?? this._active ?? this._latest;
        if (!resource || resource.released || resource.service !== this) throw new Error('Water field must be prepared by this service before preparing a frame.');
        const quality = waterFieldQuality(options.qualityDecision, resource.resolution);
        return this._snapshot(resource, options, quality);
    }

    getBindings(prepared = null) {
        const resource = prepared?.resource ?? this._encoding?.resource ?? this._active ?? this._latest;
        if (!resource || resource.released || resource.service !== this) throw new Error('Water field bindings are not prepared by this service.');
        return { layout: resource.layout, bindGroup: resource.bindGroup, entries: resource.entries, frameBuffer: resource.frameBuffer,
            textures: resource.textures, views: resource.views, textureDescriptor: resource.textureDescriptor,
            resolution: resource.resolution, mipLevels: resource.mipLevels, resourceBytes: resource.resourceBytes, epoch: resource.epoch };
    }

    _upload(prepared) {
        const r = prepared.resource, p = this.recipe.parameters, analytic = this.recipe.model === 'analytic-cache-v2';
        const lengths = analytic ? [this.recipe.cacheDomainLength, 32, 4, p.depth] : [256, 32, 4, p.depth];
        const frame = new ArrayBuffer(64), floats = new Float32Array(frame), integers = new Uint32Array(frame);
        floats.set([prepared.time, prepared.heightScale, prepared.choppiness, r.seed.heightSigma], 0);
        integers.set([r.resolution, analytic ? 1 : prepared.quality.activeLayers, r.mipLevels, analytic ? 1 : 0], 4);
        floats.set(lengths, 8); floats.set([prepared.origin[0], prepared.origin[1], p.flow[0], p.flow[1]], 12);
        this.device.queue.writeBuffer(r.frameBuffer, 0, frame);
        for (let layer = 0; layer < 3; layer++) {
            const buffer = new ArrayBuffer(96), f = new Float32Array(buffer), u = new Uint32Array(buffer);
            u.set([r.resolution, layer, 0, 0], 0); f.set([prepared.time, r.seed.normalization, p.choppiness, r.seed.heightSigma], 4);
            f.set([p.windSpeed, p.windDirection, p.directionalSpread, p.shortWaveDamping], 8);
            f.set([p.minimumWavelength, p.maximumWavelength, p.depth, p.choppiness], 12);
            f.set([p.flow[0], p.flow[1], prepared.origin[0], prepared.origin[1]], 16); f.set(lengths, 20);
            this.device.queue.writeBuffer(r.paramsBuffers[layer], 0, buffer);
        }
    }

    encode(encoder, prepared = this.prepareFrame()) {
        this._assertLive();
        if (this._encoding) throw new Error('Water field encoding must be committed or aborted before encoding another frame.');
        if (!encoder?.beginComputePass || prepared?.service !== this || prepared.resource.released || prepared.resource.retiring) throw new TypeError('Water field encode requires its live prepared snapshot and an external encoder.');
        const r = prepared.resource;
        if (!prepared.update && r.encoded) return this._encodingToken(prepared, false);
        this._upload(prepared);
        const dispatch = (pipeline, group, x, y, z, label) => {
            const pass = encoder.beginComputePass({ label }); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, y, z); pass.end();
        };
        try {
        for (let layer = 0; layer < r.domainGroups.length; layer++) {
            const domain = r.domainGroups[layer];
            dispatch(r.pipelines.evolve, domain.evolve, Math.ceil(r.resolution / 8), Math.ceil(r.resolution / 8), r.fft ? 1 : 3, `${this.label}.domain${layer}.evolve`);
            if (r.fft) {
                r.fft.encode(encoder);
                dispatch(r.pipelines.unpack, domain.unpack, Math.ceil(r.resolution / 8), Math.ceil(r.resolution / 8), 1, `${this.label}.domain${layer}.unpack`);
            }
        }
        for (const mip of r.mipPasses) {
            dispatch(r.pipelines.mip, mip.group, Math.ceil(mip.extent / 8), Math.ceil(mip.extent / 8), 15, `${this.label}.linearMoments.mip${mip.mip}`);
            encoder.copyTextureToTexture({ texture: r.mipScratch }, { texture: r.textures[0], mipLevel: mip.mip },
                { width: mip.extent, height: mip.extent, depthOrArrayLayers: 15 });
        }
        return this._encodingToken(prepared, true);
        } catch (error) {
            if (r.epoch) this._upload({ resource: r, ...r.epoch });
            this._log('water-field-encode-failed', { error: error.message }); throw error;
        }
    }

    _encodingToken(prepared, updated) {
        const resource = prepared.resource;
        const epoch = updated ? Object.freeze({ time: prepared.time, origin: prepared.origin, heightScale: prepared.heightScale,
            choppiness: prepared.choppiness, quality: prepared.quality }) : resource.epoch;
        let state = 'encoded';
        const token = { ...this.getBindings(prepared), service: this, resource, prepared, epoch, updated,
            get state() { return state; },
            commit: () => {
                this._assertLive();
                if (state !== 'encoded' || this._encoding !== token) throw new Error('Water field token can be committed exactly once.');
                if (updated) { resource.encoded = true; resource.epoch = epoch; this._encodeCount++; }
                this._active = resource; this._encoding = null; state = 'committed';
                return this.getBindings(prepared);
            },
            abort: () => {
                if (state !== 'encoded') return;
                if (!this._disposed && !resource.released && resource.epoch && updated) this._upload({ resource, ...resource.epoch });
                this._encoding = null; state = 'aborted';
                this._log('water-field-encoding-aborted', { resolution: resource.resolution, time: prepared.time });
            },
        };
        this._encoding = token;
        return token;
    }

    commit(token) { if (token?.service !== this) throw new TypeError('Foreign water field token.'); return token.commit(); }
    abort(token) { if (token?.service !== this) throw new TypeError('Foreign water field token.'); return token.abort(); }

    /** The host supplies the completion promise for every last use. Until it
     * resolves, retiring resources still count against candidate residency. */
    retire(prepared, completion) {
        const resource = prepared?.resource ?? prepared;
        if (!this._resources.has(resource) || resource === this._active || resource === this._encoding?.resource || resource.retiring) throw new Error('Only an unused water field candidate can be retired once.');
        if (resource.encoded && !completion?.then) throw new TypeError('Encoded water resources require a host completion promise before retirement.');
        resource.retiring = true;
        return Promise.resolve(completion).then(() => this._destroyResource(resource));
    }

    _destroyResource(resource) {
        if (resource.released) return;
        resource.released = true; resource.fft?.dispose(); destroyBuffers(resource.buffers); resource.textures.forEach(texture => texture.destroy());
        this._resources.delete(resource); if (this._latest === resource) this._latest = this._active;
        this._log('water-field-retired', { resolution: resource.resolution, resourceBytes: resource.resourceBytes });
    }

    diagnostics() { return { model: this.recipe.model, sourceHash: this.recipe.sourceHash, residentBytes: this.resourceBytes,
        maxBytes: this.maxBytes, resourceCount: this._resources.size, encodeCount: this._encodeCount, epoch: this._active?.epoch ?? null,
        resolution: this._active?.resolution ?? this._latest?.resolution ?? null, domains: this.recipe.domains }; }

    /** Host retirement also waits for asynchronous candidate rollback. */
    whenSettled() { return this._preparation; }

    resourceCounts() {
        return Array.from(this._resources).reduce((counts, resource) => ({
            buffers: counts.buffers + resource.buffers.length + (resource.fft ? resource.fft.paramsBuffers.length + resource.fft.buffers.length : 0),
            textures: counts.textures + resource.textures.length,
        }), { buffers: 0, textures: 0 });
    }

    /** Call after the host has drained its submissions. */
    dispose() {
        if (this._disposed) return; this._disposed = true;
        this._encoding?.abort();
        for (const resource of Array.from(this._resources)) this._destroyResource(resource);
        this._active = null; this._latest = null; this._log('water-field-disposed', { encodeCount: this._encodeCount });
    }
}

export function createWaterFieldService(options) { return new WaterFieldService(options); }
