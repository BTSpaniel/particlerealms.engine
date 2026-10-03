// SPDX-License-Identifier: MIT
/** NvFlowContext backend borrowing a Chrome WebGPU device. */
export class FlowHostWebGpu {
    static async create(module, device, shaderRoot, { maxBlocks = 128, cellSize = .15 } = {}) {
        if (!device?.features.has('float32-filterable')) throw new Error('Flow requires a device with float32-filterable');
        if (device.limits.maxComputeInvocationsPerWorkgroup < 1024 || device.limits.maxComputeWorkgroupSizeX < 1024) throw new Error('Flow requires a device configured for 1024 compute invocations and workgroup size X');
        if (!Number.isInteger(maxBlocks) || maxBlocks < 16 || maxBlocks > 4096 || !Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Invalid Flow grid limits');
        if (module._pr_flow_host_abi?.() !== 1) throw new Error('Flow host ABI 1 is required');
        const root = shaderRoot.replace(/\/$/, '');
        const manifest = await (await fetch(`${root}/manifest.json`)).json();
        const shaders = new Map();
        const pending = [...manifest.shaders];
        await Promise.all(Array.from({ length: 6 }, async () => { while (pending.length) {
            const row = pending.shift();
            const response = await fetch(`${root}/${row.wgsl}`);
            if (!response.ok) throw new Error(`Flow shader ${row.wgsl}: ${response.status}`);
            const reflection = await (await fetch(`${root}/${row.wgsl.replace('.wgsl', '.reflection.json')}`)).json();
            shaders.set(row.wgsl, { code: await response.text(), reflection });
        } }));
        const host = new FlowHostWebGpu(module, device, shaders);
        host.cellSize = cellSize;
        module.prFlowContexts ??= new Map();
        host.id = (module.prFlowContextSequence = (module.prFlowContextSequence ?? 0) + 1);
        module.prFlowContexts.set(host.id, host);
        try {
            device.pushErrorScope('validation');
            host.handle = module._pr_flow_host_create(host.id, maxBlocks, cellSize);
            const error = await device.popErrorScope();
            if (!host.handle || error) throw new Error(error?.message ?? 'Native Flow creation failed');
            return host;
        } catch (error) { await host.dispose(); throw error; }
    }

    constructor(module, device, shaders) {
        Object.assign(this, { module, device, shaders, resources: new Map(), nextId: 1,
            retired: [], readbacks: new Set(), encoder: null, uploadChunks: [], uploadPool: [],
            texturePool: new Map(), clearPipelines: new Map(),
            handle: 0, busy: false, disposed: false,
            output: null, colliderLayers: new Map(),
            stats: { frames: 0, dispatches: 0, passes: {}, activeBlocks: 0, allocatedBytes: 0,
                collisionCount: 0, collisionEnabled: 0, collisionMode: 'one-way-native-velocity-obstacle',
                uploadWrites: 0, uploadBytes: 0, uploadChunks: 0, uploadChunkReuses: 0, queueSubmissions: 0,
                textureAllocations: 0, textureReuses: 0, textureResets: 0, pooledTextureBytes: 0 } });
    }

    _resource(value) { const id = this.nextId++; this.resources.set(id, value); return id; }
    _get(id) { const value = this.resources.get(id); if (!value) throw new Error(`Unknown Flow resource ${id}`); return value; }
    _encoder() { return this.encoder ??= this.device.createCommandEncoder({ label: 'NVIDIA Flow graph' }); }
    _flush() {
        // Each source slice owns the bytes visible at its original upload call.
        // Upload the distinct slices before submitting their interleaved native
        // copies. A staging buffer cannot return to the pool until completion.
        while (this.uploadChunks.length) {
            const chunk = this.uploadChunks.shift();
            this.retired.push({ buffer: chunk.buffer, size: chunk.size, uploadChunk: chunk });
            this.device.queue.writeBuffer(chunk.buffer, 0, chunk.bytes, 0, chunk.used);
        }
        if (this.encoder) {
            const encoder = this.encoder; this.encoder = null;
            this.device.queue.submit([encoder.finish()]); this.stats.queueSubmissions++;
        }
    }
    _upload(id, pointer, size) {
        const target = this._get(id);
        if (target.kind !== 'buffer' || !Number.isInteger(size) || size < 0 || size % 4 || size > target.size
            || !Number.isInteger(pointer) || pointer < 0 || pointer > this.module.HEAPU8.length - size)
            throw new RangeError('Invalid native Flow buffer upload');
        if (!size) return;
        let chunk = this.uploadChunks.at(-1);
        if (!chunk || chunk.used + size > chunk.size) {
            const capacity = Math.max(size, Math.min(65536, this.device.limits.maxBufferSize));
            if (capacity > this.device.limits.maxBufferSize) throw new RangeError('Native Flow upload exceeds the GPU buffer limit');
            const reusable = this.uploadPool.findIndex(value => value.size === capacity);
            if (reusable >= 0) {
                chunk = this.uploadPool.splice(reusable, 1)[0]; chunk.used = 0;
                this.stats.uploadChunkReuses++;
            } else {
                const buffer = this.device.createBuffer({ label: 'Flow ordered uploads', size: capacity,
                    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
                try { chunk = { buffer, bytes: new Uint8Array(capacity), size: capacity, used: 0 }; }
                catch (error) { buffer.destroy(); throw error; }
                this.stats.allocatedBytes += capacity; this.stats.uploadChunks++;
            }
            this.uploadChunks.push(chunk);
        }
        // Copy immediately: native storage can be reused and WASM memory can
        // grow before the next callback. Never retain a view into that heap.
        chunk.bytes.set(this.module.HEAPU8.subarray(pointer, pointer + size), chunk.used);
        this._encoder().copyBufferToBuffer(chunk.buffer, chunk.used, target.buffer, 0, size);
        chunk.used += size; this.stats.uploadWrites++; this.stats.uploadBytes += size;
    }
    _text(ptr) { const bytes = this.module.HEAPU8; let end = ptr; while (bytes[end]) end++; return new TextDecoder().decode(bytes.subarray(ptr, end)); }
    _words(ptr, count) { return Array.from(this.module.HEAPU32.subarray(ptr / 4, ptr / 4 + count)); }

    _texture(format, dimension, size, mipLevelCount) {
        const key = JSON.stringify([format, dimension, ...size, mipLevelCount]);
        const texelBytes = format.startsWith('rgba32') ? 16 : format.startsWith('rg32') ? 8 : 4;
        const mipSizes = Array.from({ length: mipLevelCount }, (_, level) => size.map((value, axis) =>
            axis === 2 && dimension !== '3d' ? value : Math.max(1, value >> level)));
        const bytes = mipSizes.reduce((sum, extent) => sum + extent[0] * extent[1] * extent[2] * texelBytes, 0);
        // A never-used texture may still need backend initialization before
        // its first storage write. Account for padded rows and conservative
        // staging-buffer growth before admitting that descriptor to the cache.
        const paddedUploadBytes = Math.ceil(size[0] * texelBytes / 256) * 256 * size[1]
            * (dimension === '3d' ? size[2] : 1);
        const cacheable = bytes <= 32 * 1024 * 1024
            && 2 ** Math.ceil(Math.log2(Math.max(4, paddedUploadBytes))) <= this.device.limits.maxBufferSize;
        // Native authoring declares large scratch atlases even when the
        // corresponding operator has no input. Keep only the logical descriptor
        // until an actual GPU command or published output consumes it.
        return { kind: 'texture', texture: null, format, dimension, size, mipLevelCount,
            descriptorKey: key, bytes: 0, allocationBytes: bytes, mipSizes, cacheable };
    }

    _materializeTexture(resource) {
        if (resource.texture) {
            if (resource.resetPending) {
                this._clearTexture(resource, resource.mipSizes); resource.resetPending = false;
            }
            return resource.texture;
        }
        const available = this.texturePool.get(resource.descriptorKey), reused = available?.pop();
        if (available && !available.length) this.texturePool.delete(resource.descriptorKey);
        if (reused) {
            this.stats.pooledTextureBytes -= reused.bytes;
            // Transfer ownership to the registered logical resource before any
            // fallible reset operation. Disposal must see this lease exactly once.
            Object.assign(resource, { texture: reused.texture, bytes: reused.bytes,
                clearViews: reused.clearViews, clearBindings: reused.clearBindings, resetPending: true });
            this._clearTexture(resource, resource.mipSizes); resource.resetPending = false;
            this.stats.textureReuses++;
        } else {
            const { size, dimension, format, mipLevelCount } = resource;
            resource.texture = this.device.createTexture({ size, dimension, format, mipLevelCount, label: `Flow ${format}`,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
            resource.bytes = resource.allocationBytes;
            this.stats.allocatedBytes += resource.bytes; this.stats.textureAllocations++;
        }
        return resource.texture;
    }

    _clearTexture(resource, mipSizes) {
        const dimension = resource.dimension === '2d' && resource.size[2] > 1 ? '2d-array' : resource.dimension;
        const key = `${dimension}:${resource.format}`;
        let clear = this.clearPipelines.get(key);
        if (!clear) {
            const storage = dimension.replace('-', '_');
            const value = resource.format.endsWith('uint') ? 'vec4u(0)' : resource.format.endsWith('sint') ? 'vec4i(0)' : 'vec4f(0)';
            const workgroup = dimension === '1d' ? [64, 1, 1] : dimension === '2d' ? [8, 8, 1] : [4, 4, 4];
            const condition = dimension === '1d' ? 'id.x < size' : dimension === '2d' ? 'all(id.xy < size)'
                : dimension === '2d-array' ? 'all(id.xy < size) && id.z < textureNumLayers(resetAtlas)' : 'all(id < size)';
            const coordinates = dimension === '1d' ? 'i32(id.x)' : dimension === '2d' ? 'vec2i(id.xy)'
                : dimension === '2d-array' ? 'vec2i(id.xy), i32(id.z)' : 'vec3i(id)';
            const module = this.device.createShaderModule({ label: `Flow texture reset ${key}`, code: `
                @group(0) @binding(0) var resetAtlas: texture_storage_${storage}<${resource.format}, write>;
                @compute @workgroup_size(${workgroup.join(',')})
                fn main(@builtin(global_invocation_id) id: vec3u) {
                    let size = textureDimensions(resetAtlas);
                    if (${condition}) { textureStore(resetAtlas, ${coordinates}, ${value}); }
                }` });
            const pipeline = this.device.createComputePipeline({ label: `Flow texture reset ${key}`, layout: 'auto',
                compute: { module, entryPoint: 'main' } });
            clear = { pipeline, workgroup }; this.clearPipelines.set(key, clear);
        }
        // No full-size zero-source texture is created. Cache admission also
        // excludes descriptors whose initialization upload exceeds the limit.
        resource.clearViews ??= mipSizes.map((_, level) => resource.texture.createView({
            dimension, baseMipLevel: level, mipLevelCount: 1,
        }));
        if (resource.clearBindings?.pipeline !== clear.pipeline) resource.clearBindings = {
            pipeline: clear.pipeline,
            groups: resource.clearViews.map(view => this.device.createBindGroup({ layout: clear.pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: view },
            ] })),
        };
        for (let level = 0; level < mipSizes.length; ++level) {
            const pass = this._encoder().beginComputePass({ label: `Flow texture reset ${key}` });
            pass.setPipeline(clear.pipeline); pass.setBindGroup(0, resource.clearBindings.groups[level]);
            pass.dispatchWorkgroups(...mipSizes[level].map((extent, axis) => Math.ceil(extent / clear.workgroup[axis]))); pass.end();
            this.stats.textureResets++;
        }
    }

    call(op, a, b, c, d, e, f) {
        const { device } = this;
        switch (op) {
            case 1: {
                const size = Math.max(4, Math.ceil(a / 4) * 4);
                const usage = c === 2 ? GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                    : GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | ((b & 1) ? GPUBufferUsage.UNIFORM : 0);
                this.stats.allocatedBytes += size;
                return this._resource({ kind: 'buffer', buffer: device.createBuffer({ label: 'Flow buffer', size, usage }), size, memory: c, pointer: d });
            }
            case 2: {
                const resource = this._get(a); this.resources.delete(a); this.readbacks.delete(resource);
                this.retired.push(resource); return;
            }
            case 3: {
                this._upload(a, b, c); return;
            }
            case 4: {
                const [type, usage, code, width, height, depth, mipLevelCount] = this._words(a, 7);
                const formats = { 1: 'rgba32float', 2: 'rgba32uint', 3: 'rgba32sint', 7: 'rgba32float',
                    12: 'rg32float', 13: 'rg32uint', 14: 'rg32sint', 18: 'rgba8unorm', 23: 'rg32float',
                    28: 'r32float', 29: 'r32uint', 30: 'r32sint', 35: 'r32float', 40: 'r32float' };
                const format = formats[code]; if (!format) throw new Error(`Unsupported Flow texture format ${code}`);
                const dimension = ['1d', '2d', '3d'][type];
                return this._resource(this._texture(format, dimension, [width, height, depth], mipLevelCount));
            }
            case 5: {
                const [u, v, w, filter] = this._words(a, 4), modes = ['repeat', 'clamp-to-edge', 'mirror-repeat', 'clamp-to-edge'];
                return this._resource({ kind: 'sampler', border: [u, v, w].some(n => n === 3), sampler: device.createSampler({ addressModeU: modes[u], addressModeV: modes[v], addressModeW: modes[w], minFilter: filter ? 'linear' : 'nearest', magFilter: filter ? 'linear' : 'nearest' }) });
            }
            case 6: return this._resource({ kind: 'pipeline', name: this._text(a), pipeline: null });
            case 7: {
                if (!d || !e || !f) return;
                const resource = this._get(a), writes = this._words(b, c * 3);
                this._pipeline(resource, writes);
                const entries = [];
                for (let i = 0; i < writes.length; i += 3) {
                    const value = this._get(writes[i + 2]);
                    entries.push({ binding: writes[i], resource: value.kind === 'buffer' ? { buffer: value.buffer }
                        : value.kind === 'texture' ? this._materializeTexture(value).createView() : value.sampler });
                }
                const group = device.createBindGroup({ layout: resource.pipeline.getBindGroupLayout(0), entries });
                const pass = this._encoder().beginComputePass({ label: resource.name });
                pass.setPipeline(resource.pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(d, e, f); pass.end();
                this.stats.dispatches++; this.stats.passes[resource.name] = (this.stats.passes[resource.name] ?? 0) + 1; return;
            }
            case 8: {
                const src = this._get(a), dst = this._get(b);
                this._encoder().copyBufferToBuffer(src.buffer, c, dst.buffer, d, e);
                if (dst.memory === 2) this.readbacks.add(dst); return;
            }
            case 9: case 10: return this._copyBufferTexture(op, this._get(a), this._get(b), this._words(c, 10));
            case 11: {
                const p = this._words(c, 11);
                this._encoder().copyTextureToTexture({ texture: this._materializeTexture(this._get(a)), mipLevel: p[0], origin: p.slice(1, 4) },
                    { texture: this._materializeTexture(this._get(b)), mipLevel: p[4], origin: p.slice(5, 8) }, p.slice(8, 11)); return;
            }
            case 12: {
                const density = this._get(a), velocity = b ? this._get(b) : null;
                this._materializeTexture(density);
                if (velocity) this._materializeTexture(velocity);
                this.output = { density, velocity,
                    sparse: d ? this._get(d) : null, level: e ? this._words(e, 32) : null,
                    layer: f ? Array.from(this.module.HEAPF32.subarray(f / 4, f / 4 + 3)) : null,
                    layerAndLevel: f ? this._words(f + 28, 1)[0] : 0 };
                this.stats.activeBlocks = c; return;
            }
            case 13: {
                if (!this.output) throw new Error('Flow layer metadata requires render output');
                this.output.layers = Array.from({ length: b }, (_, index) => {
                    const base = a / 4 + index * 8;
                    return { id: this.module.HEAPU32[base],
                        blockSizeWorld: Array.from(this.module.HEAPF32.subarray(base + 1, base + 4)),
                        layerAndLevel: this.module.HEAPU32[base + 4] };
                });
                return;
            }
            default: throw new Error(`Unsupported Flow context operation ${op}`);
        }
    }

    _pipeline(resource, writes) {
        const source = this.shaders.get(resource.name);
        if (!source) throw new Error(`Missing Flow shader ${resource.name}`);
        let code = source.code;
        const formats = new Map();
        for (let i = 0; i < writes.length; i += 3) {
            const resource = this._get(writes[i + 2]);
            if (resource.kind === 'texture') formats.set(writes[i], resource.format);
        }
        const variant = JSON.stringify([...formats]);
        resource.variants ??= new Map();
        if (resource.variants.has(variant)) { resource.pipeline = resource.variants.get(variant); return; }
        // HLSL storage declarations are format agnostic. WGSL binds a concrete
        // format, so specialize each pipeline to the native graph's texture.
        code = code.replace(/(@binding\((\d+)\)[^\n]*?texture_storage_\w+<\s*)(\w+)/g,
            (whole, prefix, binding, format) => prefix + (formats.get(Number(binding)) ?? format));
        const storage = new Map([...code.matchAll(/@binding\((\d+)\)[^\n]*?var\s+\w+\s*:\s*texture_storage_\w+<\s*(\w+)\s*,\s*(\w+)\s*>/g)].map(m => [Number(m[1]), [m[2], m[3]]]));
        const entries = source.reflection.parameters.map(p => {
            const entry = { binding: p.binding.index, visibility: GPUShaderStage.COMPUTE }, t = p.type;
            if (t.kind === 'constantBuffer') entry.buffer = { type: 'uniform' };
            else if (t.kind === 'samplerState') entry.sampler = { type: 'filtering' };
            else if (t.baseShape === 'structuredBuffer' || t.baseShape === 'byteAddressBuffer') entry.buffer = { type: t.access === 'readWrite' ? 'storage' : 'read-only-storage' };
            else {
                const dimension = t.baseShape.replace('texture', '').toLowerCase();
                if (t.access === 'readWrite') {
                    const binding = storage.get(entry.binding);
                    if (!binding) throw new Error(`Missing WGSL storage declaration ${resource.name}:${entry.binding}`);
                    entry.storageTexture = { access: 'write-only', format: binding[0], viewDimension: dimension };
                } else {
                    // Mesh closest-face atlases are integer textures. Match the
                    // native resource instead of treating every sample as float.
                    const format = formats.get(entry.binding);
                    entry.texture = { sampleType: format?.endsWith('uint') ? 'uint' : format?.endsWith('sint') ? 'sint' : 'float', viewDimension: dimension };
                }
            }
            return entry;
        });
        const layout = this.device.createBindGroupLayout({ entries });
        const samplers = writes.filter((_, index) => index % 3 === 0 && writes[index + 1] === 5).map(binding => {
            for (let i = 0; i < writes.length; i += 3) if (writes[i] === binding) return this._get(writes[i + 2]);
        });
        if (samplers.some(s => s.border) && code.includes('textureSampleLevel')) {
            if (!samplers.every(s => s.border) || /texture_[12]d</.test(code)) throw new Error(`Mixed border sampling requires a specialized Flow shader: ${resource.name}`);
            code = code.replaceAll('textureSampleLevel(', 'flowBorderSample3D(') + `
                fn flowBorderLoad(t: texture_3d<f32>, p: vec3i, level: i32) -> vec4f {
                    if (any(p < vec3i(0)) || any(p >= vec3i(textureDimensions(t, level)))) { return vec4f(0); }
                    return textureLoad(t, p, level);
                }
                fn flowBorderSample3D(t: texture_3d<f32>, s: sampler, uv: vec3f, lod: f32) -> vec4f {
                    let level=i32(lod); let pos=uv*vec3f(textureDimensions(t,level))-.5;
                    let p=vec3i(floor(pos)); let f=fract(pos);
                    let a=mix(flowBorderLoad(t,p,level),flowBorderLoad(t,p+vec3i(1,0,0),level),f.x);
                    let b=mix(flowBorderLoad(t,p+vec3i(0,1,0),level),flowBorderLoad(t,p+vec3i(1,1,0),level),f.x);
                    let c=mix(flowBorderLoad(t,p+vec3i(0,0,1),level),flowBorderLoad(t,p+vec3i(1,0,1),level),f.x);
                    let d=mix(flowBorderLoad(t,p+vec3i(0,1,1),level),flowBorderLoad(t,p+vec3i(1,1,1),level),f.x);
                    return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);
                }`;
        }
        const module = this.device.createShaderModule({ label: resource.name, code });
        resource.pipeline = this.device.createComputePipeline({ label: resource.name,
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } });
        resource.variants.set(variant, resource.pipeline);
    }

    _copyBufferTexture(op, src, dst, p) {
        const [offset, rowPitch, depthPitch, mipLevel, x, y, z, width, height, depth] = p;
        if (rowPitch % 256) throw new Error(`Flow texture row pitch ${rowPitch} requires WebGPU repacking`);
        const buffer = { buffer: op === 9 ? src.buffer : dst.buffer, offset, bytesPerRow: rowPitch, rowsPerImage: depthPitch / rowPitch };
        const texture = { texture: this._materializeTexture(op === 9 ? dst : src), mipLevel, origin: [x, y, z] };
        if (op === 9) this._encoder().copyBufferToTexture(buffer, texture, [width, height, depth]);
        else { this._encoder().copyTextureToBuffer(texture, buffer, [width, height, depth]); if (dst.memory === 2) this.readbacks.add(dst); }
    }

    async step(dt = 1 / 60) {
        if (this.disposed || this.busy || this.fault) throw new Error('Flow is disposed, failed, or already stepping');
        if (!Number.isFinite(dt) || dt <= 0 || dt > .1) throw new RangeError('Flow steps must be in (0, 0.1] seconds');
        this.busy = true; this.device.pushErrorScope('validation');
        let scopeOpen = true;
        try {
            if (!this.module._pr_flow_host_step(this.handle, dt)) throw new Error('Native Flow step rejected');
            this._flush();
            await this.device.queue.onSubmittedWorkDone();
            const error = await this.device.popErrorScope(); scopeOpen = false;
            if (error) throw new Error(error.message);
            for (const b of this.readbacks) {
                await b.buffer.mapAsync(GPUMapMode.READ);
                this.module.HEAPU8.set(new Uint8Array(b.buffer.getMappedRange()), b.pointer); b.buffer.unmap();
            }
            this.readbacks.clear(); this.module._pr_flow_host_complete(this.handle); this._retire(); this.stats.frames++;
        } catch (error) { this.fault = error; throw error; }
        finally {
            this.busy = false;
            if (scopeOpen) await this.device.popErrorScope();
        }
        return this.output;
    }

    setEmitter({ position = [0, 0, 0], velocity = [0, 2, 0], radius = .45, temperature = 1, fuel = .8, smoke = .5, enabled = true } = {}) {
        if (this.disposed || this.busy) throw new Error('Flow is disposed or already stepping');
        if (this.customScene) throw new Error('Use setScene to update emitters in a custom Flow scene');
        if (position?.length !== 3 || !position.every(Number.isFinite) || velocity?.length !== 3 || !velocity.every(Number.isFinite) || ![radius, temperature, fuel, smoke].every(Number.isFinite)
            || radius <= 0 || Math.min(temperature, fuel, smoke) < 0) throw new RangeError('Invalid Flow emitter');
        if (!this.module._pr_flow_host_emitter(this.handle, ...position, radius, temperature, fuel, smoke, enabled ? 1 : 0)) throw new RangeError('Invalid Flow emitter');
        if (!this.module._pr_flow_host_airflow?.(this.handle, ...velocity)) throw new Error('Flow airflow export is required');
    }

    /** Atomically replace native layers and sphere/box/point/mesh emitters. Omitted emitter
     * fields use upstream defaults; transforms use xyzw quaternions and world
     * velocity. Existing field contents evolve normally after source removal.
     * Geometry uses owned flat xyz arrays, triangle indices and optional world
     * velocities per vertex. Points deposit into neighboring grid cells; widths
     * are not exposed by this single-level API. Meshes emit in a signed shell.
     */
    setScene({ layers = [{ id: 0 }], emitters = [] } = {}) {
        if (this.disposed || this.busy || this.fault) throw new Error('Flow is disposed, failed, or already stepping');
        if (this.module._pr_flow_host_scene_abi?.() !== 1) throw new Error('Flow scene ABI 1 is required');
        if (!Array.isArray(layers) || !layers.length || layers.length > 32
            || !Array.isArray(emitters) || emitters.length > 1024) throw new RangeError('Flow scene requires 1–32 layers and at most 1024 emitters');
        const packet = new ArrayBuffer(layers.length * 32 + emitters.length * 128);
        const words = new Uint32Array(packet), floats = new Float32Array(packet);
        const finite = (value, name, minimum = -Infinity, positive = false) => {
            if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))
                || value < minimum || (positive && Math.fround(value) <= 0)) throw new RangeError(`Invalid Flow ${name}`);
            return value;
        };
        const vector = (value, length, name) => {
            if (!value || value.length !== length || typeof value.every !== 'function') throw new RangeError(`Invalid Flow ${name}`);
            return Array.from(value, item => finite(item, name));
        };
        const id = (value, name, minimum, maximum) => {
            if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid Flow ${name}`);
            return value;
        };
        const boolean = (value, name) => {
            if (typeof value !== 'boolean') throw new RangeError(`Invalid Flow ${name}`);
            return value ? 1 : 0;
        };
        const layerIds = new Set(), emitterIds = new Set(), geometries = [];
        layers.forEach((layer, index) => {
            if (!layer || typeof layer !== 'object') throw new RangeError('Invalid Flow layer');
            const { id: layerId, cellSize = this.cellSize, gravity = [0, -9.81, 0],
                pressure = true, combustion = true, vorticity = .6 } = layer;
            const offset = index * 8;
            words[offset] = id(layerId, 'layer id', 0, 65535);
            if (layerIds.has(layerId)) throw new RangeError('Duplicate Flow layer id');
            layerIds.add(layerId);
            floats[offset + 1] = finite(cellSize, 'cell size', 0, true);
            floats.set(vector(gravity, 3, 'gravity'), offset + 2);
            words[offset + 5] = boolean(pressure, 'pressure');
            words[offset + 6] = boolean(combustion, 'combustion');
            floats[offset + 7] = finite(vorticity, 'vorticity', 0);
            if (vorticity > 10) throw new RangeError('Vorticity must be in [0, 10]');
        });
        for (const layer of this.colliderLayers.values()) if (!layerIds.has(layer))
            throw new RangeError('Remove Flow colliders before removing their layer');
        emitters.forEach((emitter, index) => {
            if (!emitter || typeof emitter !== 'object') throw new RangeError('Invalid Flow emitter');
            const { id: emitterId, layer = 0, type = 'sphere', enabled = true, applyPostPressure = false,
                position = [0, 0, 0], radius = 10, halfSize = [10, 10, 10], quaternion = [0, 0, 0, 1],
                velocity = [0, 0, 400], temperature = .5, fuel = .8, smoke = 0, burn = 0, divergence = 0,
                coupleRateVelocity = 2, coupleRateTemperature = 2, coupleRateFuel = 2, coupleRateSmoke = 0,
                allocationScale = 1, coupleRateDivergence = 0, coupleRateBurn = 0 } = emitter;
            const offset = layers.length * 8 + index * 32;
            words[offset] = id(emitterId, 'emitter id', 1, 0xffffffff);
            if (emitterIds.has(emitterId)) throw new RangeError('Duplicate Flow emitter id');
            emitterIds.add(emitterId);
            words[offset + 1] = id(layer, 'emitter layer', 0, 65535);
            if (!layerIds.has(layer)) throw new RangeError('Flow emitter references a missing layer');
            const typeId = ['sphere', 'box', 'points', 'mesh'].indexOf(type);
            if (typeId < 0) throw new RangeError('Flow scene supports sphere, box, points and mesh emitters');
            words[offset + 2] = typeId;
            words[offset + 3] = boolean(enabled, 'enabled') | (boolean(applyPostPressure, 'applyPostPressure') << 1);
            floats.set(vector(position, 3, 'position'), offset + 4);
            if (type === 'sphere') floats[offset + 7] = finite(radius, 'radius', 0, true);
            else if (type === 'box') floats.set(vector(halfSize, 3, 'half size').map(value => finite(value, 'half size', 0, true)), offset + 7);
            else {
                if (this.module._pr_flow_host_geometry_abi?.() !== 1) throw new Error('Flow geometry ABI 1 is required');
                if (type === 'points' && this.device.limits.maxStorageBuffersPerShaderStage < 11)
                    throw new RangeError('Flow point emission requires a device configured for 11 storage buffers per shader stage');
                if (['radius', 'halfSize', 'widths', 'widthScale'].some(key => key in emitter) || allocationScale !== 1)
                    throw new RangeError('Flow geometry uses allocateMask, without sphere/box sizes or point widths');
                const { positions, velocities = [], indices = [], allocateMask = true,
                    minDistance = type === 'mesh' ? -.8 : 0, maxDistance = type === 'mesh' ? .3 : 0,
                    orientationLeftHanded = false } = emitter;
                const arrayLength = (array, name) => {
                    if (!(Array.isArray(array) || (ArrayBuffer.isView(array) && typeof array.every === 'function')))
                        throw new RangeError(`Invalid Flow ${name} array`);
                    return id(array.length, `${name} length`, 0, 0x7fffffff);
                };
                const positionLength = arrayLength(positions, 'positions'), velocityLength = arrayLength(velocities, 'velocities');
                const indexCount = arrayLength(indices, 'indices'), count = positionLength / 3, faces = indexCount / 3;
                if (!positionLength || positionLength % 3 || (velocityLength && velocityLength !== positionLength))
                    throw new RangeError('Flow geometry requires xyz positions and either zero or one xyz velocity per vertex');
                if (type === 'points' && (indexCount || 'indices' in emitter || 'minDistance' in emitter || 'maxDistance' in emitter || 'orientationLeftHanded' in emitter))
                    throw new RangeError('Flow point emitters do not accept mesh indices or shell settings');
                if (type === 'mesh' && (!indexCount || indexCount % 3 || faces > 256 ** 3))
                    throw new RangeError('Flow mesh requires indexed triangles within the native hierarchy capacity');
                // Upstream upload/dynamic buffers round to powers of two, starting
                // at 64 KiB. Admit against the actual borrowed device before copying
                // potentially large caller arrays or changing the native scene.
                const rounded = bytes => Math.max(65536, 2 ** Math.ceil(Math.log2(Math.max(1, bytes))));
                const packedBytes = (positionLength + velocityLength + indexCount) * 4 + faces * 8;
                const requiredBytes = Math.max(rounded(packedBytes), rounded(type === 'points' ? 128 * count : 32 * faces));
                if (requiredBytes > Math.min(0x80000000, this.device.limits.maxBufferSize, this.device.limits.maxStorageBufferBindingSize)
                    || this.device.limits.maxComputeWorkgroupsPerDimension < 32768)
                    throw new RangeError('Flow geometry exceeds the borrowed GPU buffer or dispatch limits');
                const p = Float32Array.from(positions, value => finite(value, 'geometry position'));
                const v = Float32Array.from(velocities, value => finite(value, 'geometry velocity'));
                const triangles = Uint32Array.from(indices, value => id(value, 'triangle index', 0, count - 1));
                for (let i = 0; i < triangles.length; i += 3) {
                    const a = triangles[i] * 3, b = triangles[i + 1] * 3, c = triangles[i + 2] * 3;
                    const ax = p[b] - p[a], ay = p[b + 1] - p[a + 1], az = p[b + 2] - p[a + 2];
                    const bx = p[c] - p[a], by = p[c + 1] - p[a + 1], bz = p[c + 2] - p[a + 2];
                    if (ay * bz - az * by === 0 && az * bx - ax * bz === 0 && ax * by - ay * bx === 0)
                        throw new RangeError('Flow mesh contains a degenerate triangle');
                }
                const minimum = Math.fround(finite(minDistance, 'minimum shell distance'));
                const maximum = Math.fround(finite(maxDistance, 'maximum shell distance'));
                if (type === 'mesh' && !(minimum < maximum)) throw new RangeError('Flow mesh requires minDistance < maxDistance in f32');
                geometries.push({ id: emitterId, positions: p, velocities: v, indices: triangles,
                    flags: boolean(allocateMask, 'allocateMask') | (boolean(orientationLeftHanded, 'orientationLeftHanded') << 1),
                    minimum, maximum });
            }
            const rotation = vector(quaternion, 4, 'quaternion'), norm = Math.hypot(...rotation);
            if (!(norm > 0)) throw new RangeError('Flow quaternion cannot be zero');
            floats.set(rotation.map(value => value / norm), offset + 10);
            floats.set(vector(velocity, 3, 'velocity'), offset + 14);
            floats.set([
                finite(temperature, 'temperature', 0), finite(fuel, 'fuel', 0), finite(smoke, 'smoke', 0),
                finite(coupleRateVelocity, 'velocity coupling', 0), finite(coupleRateTemperature, 'temperature coupling', 0),
                finite(coupleRateFuel, 'fuel coupling', 0), finite(coupleRateSmoke, 'smoke coupling', 0),
                finite(allocationScale, 'allocation scale', 0), finite(divergence, 'divergence'),
                finite(coupleRateDivergence, 'divergence coupling', 0), finite(burn, 'burn', 0), finite(coupleRateBurn, 'burn coupling', 0),
            ], offset + 17);
        });
        const geometryOffset = packet.byteLength;
        const bytes = geometryOffset + geometries.length * 64 + geometries.reduce((sum, g) => sum + g.positions.byteLength + g.velocities.byteLength + g.indices.byteLength, 0);
        if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Flow scene exceeds the WASM packet address space');
        const packed = geometries.length ? new ArrayBuffer(bytes) : packet;
        const packedWords = new Uint32Array(packed), packedFloats = new Float32Array(packed);
        if (geometries.length) packedWords.set(words);
        // All caller arrays have already been copied. A growing malloc may detach
        // views into the WASM heap, so no caller-owned view is read below this line.
        const pointer = this.module._malloc(bytes);
        if (!pointer) throw new Error('Flow scene allocation failed');
        try {
            let cursor = geometryOffset + geometries.length * 64;
            geometries.forEach((g, index) => {
                const offset = geometryOffset / 4 + index * 16;
                packedWords[offset] = g.id;
                for (const [data, pointerWord, countWord, stride] of [[g.positions, 1, 2, 3], [g.indices, 5, 6, 1], [g.velocities, 11, 12, 3]]) {
                    if (!data.length) continue;
                    packedWords[offset + pointerWord] = pointer + cursor;
                    packedWords[offset + countWord] = data.length / stride;
                    new Uint8Array(packed, cursor, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
                    cursor += data.byteLength;
                }
                packedWords[offset + 7] = g.flags;
                packedFloats.set([1, g.minimum, g.maximum], offset + 8);
            });
            this.module.HEAPU8.set(new Uint8Array(packed), pointer);
            const accepted = geometries.length
                ? this.module._pr_flow_host_scene_geometry(this.handle, pointer, layers.length, pointer + layers.length * 32, emitters.length, pointer + geometryOffset, geometries.length)
                : this.module._pr_flow_host_scene(this.handle, pointer, layers.length, pointer + layers.length * 32, emitters.length);
            if (!accepted)
                throw new RangeError('Native Flow scene rejected');
            this.customScene = true;
            this.sceneLayerIds = layerIds;
        } finally { this.module._free(pointer); }
    }

    /** Replace velocity-only native sphere/box obstacles, in stable ID order.
     * These post-grid operators neither allocate sparse blocks nor change smoke,
     * temperature, fuel or divergence. They are one-way velocity boundaries,
     * not a pressure solid mask or a rigid-body reaction-force solver. Motion
     * comes from successive poses; resetMotion suppresses teleport velocity.
     * New/type-changed/layer-changed IDs also re-prime motion automatically.
     */
    setColliders(records = []) {
        if (this.disposed || this.busy || this.fault) throw new Error('Flow is disposed, failed, or already stepping');
        if (this.module._pr_flow_host_collision_abi?.() !== 1) throw new Error('Flow collision ABI 1 is required');
        if (!Array.isArray(records) || records.length > 1024) throw new RangeError('Flow accepts at most 1024 colliders');
        const packet = new ArrayBuffer(records.length * 80), words = new Uint32Array(packet), floats = new Float32Array(packet);
        const layers = this.sceneLayerIds ?? new Set([0]), ids = new Set(), colliderLayers = new Map();
        const finite = value => {
            if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new RangeError('Collider values must be finite f32 numbers');
            return Math.fround(value);
        };
        const vector = (value, count) => {
            if (!value || value.length !== count || typeof value.every !== 'function') throw new RangeError('Invalid collider vector');
            return Array.from(value, finite);
        };
        const boolean = value => { if (typeof value !== 'boolean') throw new RangeError('Invalid collider boolean'); return Number(value); };
        const allowed = new Set(['id', 'layer', 'type', 'position', 'quaternion', 'radius', 'halfSize',
            'coupleRateVelocity', 'multisample', 'resetMotion', 'enabled']);
        let enabledCount = 0;
        records.forEach((record, index) => {
            if (!record || typeof record !== 'object' || Object.keys(record).some(key => !allowed.has(key)))
                throw new RangeError('Unknown Flow collider field');
            const { id, layer = 0, type = 'sphere', position = [0, 0, 0], quaternion = [0, 0, 0, 1],
                radius, halfSize, coupleRateVelocity = 120, multisample = true, resetMotion = false, enabled = true } = record;
            if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || ids.has(id)) throw new RangeError('Collider IDs must be unique nonzero u32 integers');
            if (!Number.isInteger(layer) || !layers.has(layer)) throw new RangeError('Collider references an unknown Flow layer');
            if (!['sphere', 'box'].includes(type) || (type === 'sphere' ? 'halfSize' in record : 'radius' in record))
                throw new RangeError('Collider shape requires sphere radius or box halfSize');
            const sizes = type === 'sphere' ? [finite(radius), 0, 0] : vector(halfSize, 3);
            if (sizes.slice(0, type === 'sphere' ? 1 : 3).some(value => !(value > 0) || !Number.isFinite(Math.fround(value * value))))
                throw new RangeError('Collider dimensions must be positive representable f32 sizes');
            const rotation = vector(quaternion, 4), norm = Math.hypot(...rotation);
            if (!(norm > 0)) throw new RangeError('Collider quaternion cannot be zero');
            const rate = finite(coupleRateVelocity); if (rate < 0) throw new RangeError('Collider coupling cannot be negative');
            const offset = index * 20;
            words[offset] = id; words[offset + 1] = layer; words[offset + 2] = Number(type === 'box');
            words[offset + 3] = boolean(enabled) | (boolean(resetMotion) << 1) | (boolean(multisample) << 2);
            floats.set(vector(position, 3), offset + 4); floats.set(sizes, offset + 7);
            floats.set(rotation.map(value => value / norm), offset + 10); floats[offset + 14] = rate;
            ids.add(id); colliderLayers.set(id, layer); enabledCount += Number(enabled);
        });
        // Own all caller data before malloc: WASM heap growth may detach input views.
        const pointer = packet.byteLength ? this.module._malloc(packet.byteLength) : 0;
        if (packet.byteLength && !pointer) throw new Error('Flow collider allocation failed');
        try {
            if (pointer) this.module.HEAPU8.set(new Uint8Array(packet), pointer);
            if (!this.module._pr_flow_host_colliders(this.handle, pointer, records.length)) throw new RangeError('Native Flow colliders rejected');
            this.colliderLayers = colliderLayers;
            Object.assign(this.stats, { collisionCount: records.length, collisionEnabled: enabledCount });
            return { status: 'CONFIGURED', abi: 1, mode: this.stats.collisionMode, count: records.length, enabledCount };
        } finally { if (pointer) this.module._free(pointer); }
    }

    /** Gather trilinear world-space velocities from the real sparse atlas.
     * Missing sparse cells contribute zero. Explicit layer IDs select native
     * metadata; custom scenes default to layer 0 and require an explicit ID if
     * it is absent. Legacy callers retain their first-layer output contract.
     * Await sampling before stepping/disposal; no full-volume CPU transfer.
     */
    async sampleVelocity(positions, { layer } = {}) {
        if (this.disposed || this.busy || this.fault) throw new Error('Flow is disposed, failed, or busy');
        if (!positions || positions.length % 3 || positions.length > 3 * 65536 || !positions.every(Number.isFinite)) throw new RangeError('Expected at most 65536 finite xyz positions');
        const count = positions.length / 3, result = new Float32Array(positions.length), output = this.output;
        if (this.customScene && layer === undefined) {
            if (!this.sceneLayerIds.has(0)) throw new RangeError('Specify a Flow sample layer when the scene has no layer 0');
            layer = 0;
        }
        if (layer !== undefined && (!Number.isInteger(layer) || layer < 0 || layer > 65535)) throw new RangeError('Invalid Flow sample layer');
        if (layer !== undefined && !(this.sceneLayerIds ?? new Set([0])).has(layer)) throw new RangeError('Unknown Flow sample layer');
        if (!count || !this.stats.activeBlocks) return result;
        if (!output?.sparse || !output.layer || !output.velocity) throw new Error('Native Flow spatial metadata is required');
        const metadata = layer === undefined ? null : output.layers?.find(value => value.id === layer);
        if (layer !== undefined && !metadata) throw new Error('Requested Flow layer has no native spatial metadata');
        const blockSizeWorld = metadata?.blockSizeWorld ?? output.layer;
        const layerAndLevel = metadata?.layerAndLevel ?? output.layerAndLevel;
        this.busy = true;
        const { device } = this;
        try {
            if (!this.velocitySampler) {
                const module = device.createShaderModule({ label: 'Flow world velocity gather', code: `
                    @group(0) @binding(0) var field: texture_3d<f32>;
                    @group(0) @binding(1) var<storage,read> table: array<u32>;
                    @group(0) @binding(2) var<storage,read> params: array<u32>;
                    @group(0) @binding(3) var<storage,read> queries: array<vec4f>;
                    @group(0) @binding(4) var<storage,read_write> values: array<vec4f>;
                    fn cell(v: vec3i) -> vec3f {
                        let bits=vec3u(params[4],params[5],params[6]);
                        let loc=v >> bits;
                        let bucket=vec3u(loc)&vec3u(params[8],params[9],params[10]);
                        let index=(bucket.z<<params[13])|(bucket.y<<params[12])|bucket.x;
                        for(var b=table[index*2u]; b<table[index*2u+1u]; b++) {
                            let j=b*4u+params[15];
                            if(all(vec3i(vec3u(table[j],table[j+1u],table[j+2u]))==loc)&&table[j+3u]==params[32]) {
                                let packed=table[b+params[18]];
                                if((packed>>31u)==0u) { return vec3f(0); }
                                let local=v&vec3i(vec3u(params[0],params[1],params[2]));
                                let real=vec3i((local.x+i32((packed<<1u)|1u))&4095,
                                    (local.y+i32((packed>>10u)|1u))&2047,
                                    (local.z+i32((packed>>20u)|1u))&2047);
                                return textureLoad(field,real,0).xyz;
                            }
                        }
                        return vec3f(0);
                    }
                    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
                        if(id.x>=arrayLength(&queries)) { return; }
                        let p=queries[id.x].xyz; let base=vec3i(floor(p)); let f=fract(p);
                        var value=vec3f(0);
                        for(var z=0;z<2;z++) { for(var y=0;y<2;y++) { for(var x=0;x<2;x++) {
                            let w=select(1.-f,f,vec3i(x,y,z)==vec3i(1));
                            value+=cell(base+vec3i(x,y,z))*w.x*w.y*w.z;
                        }}}
                        values[id.x]=vec4f(value,0);
                    }` });
                const diagnostics = await module.getCompilationInfo();
                const errors = diagnostics.messages.filter(message => message.type === 'error');
                if (errors.length) throw new Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n'));
                this.velocitySampler = { pipeline: await device.createComputePipelineAsync({ label: 'Flow world velocity gather', layout: 'auto', compute: { module, entryPoint: 'main' } }), size: 0 };
            }
            const s = this.velocitySampler, size = count * 16;
            if (s.size !== size) {
                if (s.size) this.stats.allocatedBytes -= s.size * 3 + 132;
                for (const b of [s.queries, s.values, s.read, s.params]) b?.destroy();
                s.queries = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
                s.values = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
                s.read = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
                s.params = device.createBuffer({ size: 132, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
                s.size = size;
                this.stats.allocatedBytes += size * 3 + 132;
            }
            const queries = new Float32Array(count * 4);
            for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++)
                queries[i * 4 + axis] = positions[i * 3 + axis] * (1 << output.level[4 + axis]) / blockSizeWorld[axis] - .5;
            device.queue.writeBuffer(s.queries, 0, queries);
            device.queue.writeBuffer(s.params, 0, new Uint32Array([...output.level, layerAndLevel]));
            const group = device.createBindGroup({ layout: s.pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: output.velocity.texture.createView() },
                ...[output.sparse.buffer, s.params, s.queries, s.values].map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
            ] });
            const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
            pass.setPipeline(s.pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
            encoder.copyBufferToBuffer(s.values, 0, s.read, 0, size); device.queue.submit([encoder.finish()]);
            await s.read.mapAsync(GPUMapMode.READ);
            try {
                const values = new Float32Array(s.read.getMappedRange());
                for (let i = 0; i < count; i++) result.set(values.subarray(i * 4, i * 4 + 3), i * 3);
            } finally { s.read.unmap(); }
            if (!result.every(Number.isFinite)) throw new Error('Nonfinite Flow velocity sample');
            this.stats.velocitySamples = (this.stats.velocitySamples ?? 0) + count;
            return result;
        } catch (error) { this.fault = error; throw error; }
        finally { this.busy = false; }
    }

    _retire(recycleTextures = true) {
        // Only the most recently completed generation is retained. Unused
        // older descriptors are destroyed instead of accumulating after grid
        // growth, changed scenes, or temporary authoring workloads.
        for (const values of this.texturePool.values()) for (const r of values) {
            r.texture.destroy(); this.stats.allocatedBytes -= r.bytes;
        }
        this.texturePool.clear();
        this.stats.pooledTextureBytes = 0;
        for (const chunk of this.uploadPool) { chunk.buffer.destroy(); this.stats.allocatedBytes -= chunk.size; }
        this.uploadPool.length = 0;
        for (const r of this.retired) {
            if (recycleTextures && r.uploadChunk) this.uploadPool.push(r.uploadChunk);
            // Cache only physical allocations that were actually consumed.
            // Descriptor-only scratch owns zero GPU bytes and needs no cleanup.
            else if (recycleTextures && r.texture && r.descriptorKey && r.cacheable
                && this.stats.pooledTextureBytes + r.bytes <= 128 * 1024 * 1024) {
                if (!this.texturePool.has(r.descriptorKey)) this.texturePool.set(r.descriptorKey, []);
                this.texturePool.get(r.descriptorKey).push(r);
                this.stats.pooledTextureBytes += r.bytes;
            } else {
                r.buffer?.destroy(); r.texture?.destroy(); this.stats.allocatedBytes -= r.bytes ?? r.size ?? 0;
            }
        }
        this.retired.length = 0;
        if (!recycleTextures) this.clearPipelines.clear();
    }

    setControls({ pressure = true, combustion = true, vorticity = .6 } = {}) {
        if (this.disposed || this.busy || this.fault) throw new Error('Flow is disposed, failed, or already stepping');
        if (this.customScene) throw new Error('Use setScene to update controls in a custom Flow scene');
        if (!Number.isFinite(vorticity) || vorticity < 0 || vorticity > 10) throw new RangeError('Vorticity must be in [0, 10]');
        if (!this.module._pr_flow_host_controls(this.handle, pressure ? 1 : 0, combustion ? 1 : 0, vorticity)) throw new Error('Native Flow controls rejected');
    }

    async dispose() {
        if (this.disposed) return;
        if (this.busy) throw new Error('Await the Flow step before disposing');
        this.disposed = true;
        let failure;
        try { this._flush(); await this.device.queue.onSubmittedWorkDone(); }
        catch (error) { failure = error; }
        // Failed submissions and lost devices must release native ownership too.
        // Preserve the first error while leaving repeated dispose calls harmless.
        try { if (this.handle) this.module._pr_flow_host_destroy(this.handle); }
        catch (error) { failure ??= error; }
        finally {
            this.handle = 0; this.encoder = null;
            for (const chunk of this.uploadChunks) this.retired.push({ buffer: chunk.buffer, size: chunk.size, uploadChunk: chunk });
            this.uploadChunks.length = 0;
            this.retired.push(...this.resources.values()); this.resources.clear(); this._retire(false);
            for (const b of [this.velocitySampler?.queries, this.velocitySampler?.values, this.velocitySampler?.read, this.velocitySampler?.params]) b?.destroy();
            if (this.velocitySampler?.size) this.stats.allocatedBytes -= this.velocitySampler.size * 3 + 132;
            this.velocitySampler = null; this.readbacks.clear();
            this.module.prFlowContexts.delete(this.id); this.output = null; this.colliderLayers.clear();
            this.stats.collisionCount = 0; this.stats.collisionEnabled = 0;
        }
        if (failure) throw failure;
    }
}
