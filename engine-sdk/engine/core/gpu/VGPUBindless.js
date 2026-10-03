// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Bindless preparation - storage-buffer texture arrays for bindless-style rendering.
 */

function bindlessDestroyedError(operation) {
    const error = new Error(`Bindless manager is destroyed; cannot ${operation}`);
    error.code = 'VGPU_BINDLESS_DESTROYED';
    return error;
}

function destroyOwned(resource) {
    if (!resource) return;
    let destroy = null;
    try { destroy = resource.destroy; } catch (_) { return; }
    if (typeof destroy !== 'function') return;
    try { Reflect.apply(destroy, resource, []); } catch (_) {}
}

export class VGPUBindless {
    constructor(vgpu, options = {}) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this.maxTextures = options.maxTextures || 1024;
        this.maxBuffers = options.maxBuffers || 256;

        this._textureSlots = new Array(this.maxTextures).fill(null);
        this._textureViews = new Array(this.maxTextures).fill(null);
        this._freeTextureSlots = [];
        this._textureMap = new Map();
        this._bufferSlots = new Array(this.maxBuffers).fill(null);
        this._freeBufferSlots = [];
        this._bufferMap = new Map();
        this._descriptorBuffer = null;
        this._descriptorData = null;
        this._bindGroup = null;
        this._bindGroupLayout = null;
        this._defaultTexture = null;
        this._defaultView = null;
        this._defaultSampler = null;
        this._dirty = true;
        this._destroyed = false;
        this._generation = 0;
        this._layoutBuildGeneration = null;
        this._bindGroupBuildGeneration = null;

        this._init();
    }

    _assertActive(operation = 'perform work') {
        if (this._destroyed || !this.device || !this.vgpu) {
            throw bindlessDestroyedError(operation);
        }
        return this._generation;
    }

    _isGeneration(generation) {
        return !this._destroyed && generation === this._generation;
    }

    _assertGeneration(generation, operation) {
        if (!this._isGeneration(generation)) throw bindlessDestroyedError(operation);
    }

    _readExternalMember(receiver, key, generation, operation) {
        this._assertGeneration(generation, operation);
        let value;
        try {
            value = receiver?.[key];
        } finally {
            this._assertGeneration(generation, operation);
        }
        return value;
    }

    _captureExternalCallable(receiver, key, generation, operation) {
        const callable = this._readExternalMember(receiver, key, generation, operation);
        if (typeof callable !== 'function') {
            throw new TypeError(`[Bindless] ${String(key)} is not callable`);
        }
        this._assertGeneration(generation, operation);
        return { receiver, callable };
    }

    _silenceExternalPromise(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
        try {
            Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
        } catch (_) {}
    }

    _invokeCapturedExternal(captured, args, generation, operation, retireResult = null) {
        this._assertGeneration(generation, operation);
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        try {
            this._assertGeneration(generation, operation);
        } catch (error) {
            this._silenceExternalPromise(result);
            if (retireResult && result) {
                try { retireResult(result); } catch (_) {}
            }
            throw error;
        }
        if (callError) throw callError;
        return result;
    }

    _callExternal(receiver, key, args, generation, operation, retireResult = null) {
        const captured = this._captureExternalCallable(receiver, key, generation, operation);
        return this._invokeCapturedExternal(
            captured, args, generation, operation, retireResult,
        );
    }

    _snapshotNumber(value, generation, operation) {
        let normalized;
        try {
            normalized = Number(value);
        } finally {
            this._assertGeneration(generation, operation);
        }
        return normalized;
    }

    _init() {
        const generation = this._assertActive('initialize');
        const device = this.device;
        const queue = this._readExternalMember(
            this.vgpu, 'queue', generation, 'resolve the initialization queue',
        );
        let defaultTexture = null;
        let descriptorBuffer = null;

        try {
            for (let index = this.maxTextures - 1; index >= 0; index--) {
                this._freeTextureSlots.push(index);
            }
            for (let index = this.maxBuffers - 1; index >= 0; index--) {
                this._freeBufferSlots.push(index);
            }

            defaultTexture = this._callExternal(device, 'createTexture', [{
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label: 'Bindless_DefaultTexture',
            }], generation, 'initialize the default texture', destroyOwned);
            this._callExternal(
                queue, 'writeTexture', [
                { texture: defaultTexture },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1 },
                ], generation, 'upload the default texture',
            );

            const defaultSampler = this._callExternal(device, 'createSampler', [{
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                label: 'Bindless_DefaultSampler',
            }], generation, 'initialize the default sampler');

            descriptorBuffer = this._callExternal(device, 'createBuffer', [{
                size: this.maxBuffers * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                label: 'Bindless_Descriptors',
            }], generation, 'initialize descriptor storage', destroyOwned);
            const descriptorData = new Float32Array(this.maxBuffers * 4);
            const defaultView = this._callExternal(
                defaultTexture, 'createView', [], generation,
                'initialize the default texture view',
            );

            this._defaultTexture = defaultTexture;
            this._defaultView = defaultView;
            this._defaultSampler = defaultSampler;
            this._descriptorBuffer = descriptorBuffer;
            this._descriptorData = descriptorData;
            this._textureViews.fill(defaultView);
            defaultTexture = null;
            descriptorBuffer = null;
        } catch (error) {
            destroyOwned(descriptorBuffer);
            destroyOwned(defaultTexture);
            throw error;
        }
    }

    registerTexture(texture, view = null) {
        const generation = this._assertActive('register a texture');
        if (this._textureMap.has(texture)) return this._textureMap.get(texture);
        if (this._freeTextureSlots.length === 0) {
            console.error('[Bindless] No free texture slots');
            return -1;
        }

        const textureView = view || this._callExternal(
            texture, 'createView', [], generation, 'create a registered texture view',
        );
        this._assertGeneration(generation, 'publish a texture registration');
        if (this._textureMap.has(texture)) return this._textureMap.get(texture);
        if (this._freeTextureSlots.length === 0) {
            console.error('[Bindless] No free texture slots');
            return -1;
        }

        const slot = this._freeTextureSlots.pop();
        this._textureSlots[slot] = texture;
        this._textureViews[slot] = textureView;
        this._textureMap.set(texture, slot);
        this._dirty = true;
        return slot;
    }

    unregisterTexture(texture) {
        this._assertActive('unregister a texture');
        const slot = this._textureMap.get(texture);
        if (slot === undefined) return false;
        this._textureSlots[slot] = null;
        this._textureViews[slot] = this._defaultView;
        this._textureMap.delete(texture);
        this._freeTextureSlots.push(slot);
        this._dirty = true;
        return true;
    }

    getTextureIndex(texture) {
        if (this._destroyed || !this._textureMap) return -1;
        return this._textureMap.get(texture) ?? -1;
    }

    registerBuffer(buffer, metadata = {}) {
        const generation = this._assertActive('register a buffer');
        if (this._bufferMap.has(buffer)) return this._bufferMap.get(buffer);
        if (this._freeBufferSlots.length === 0) {
            console.error('[Bindless] No free buffer slots');
            return -1;
        }

        const rawOffset = this._readExternalMember(
            metadata, 'offset', generation, 'read a buffer descriptor offset',
        );
        const rawSize = this._readExternalMember(
            metadata, 'size', generation, 'read a buffer descriptor size',
        );
        const rawStride = this._readExternalMember(
            metadata, 'stride', generation, 'read a buffer descriptor stride',
        );
        const rawFlags = this._readExternalMember(
            metadata, 'flags', generation, 'read buffer descriptor flags',
        );
        const fallbackSize = rawSize === undefined
            ? this._readExternalMember(buffer, 'size', generation, 'read registered buffer size')
            : rawSize;
        const offset = this._snapshotNumber(rawOffset ?? 0, generation, 'normalize buffer offset');
        const size = this._snapshotNumber(fallbackSize, generation, 'normalize buffer size');
        const stride = this._snapshotNumber(rawStride ?? 0, generation, 'normalize buffer stride');
        const flags = this._snapshotNumber(rawFlags ?? 0, generation, 'normalize buffer flags');
        this._assertGeneration(generation, 'publish a buffer registration');
        if (this._bufferMap.has(buffer)) return this._bufferMap.get(buffer);
        if (this._freeBufferSlots.length === 0) {
            console.error('[Bindless] No free buffer slots');
            return -1;
        }

        const slot = this._freeBufferSlots.pop();
        this._bufferSlots[slot] = buffer;
        this._bufferMap.set(buffer, slot);
        this._descriptorData[slot * 4] = offset;
        this._descriptorData[slot * 4 + 1] = size;
        this._descriptorData[slot * 4 + 2] = stride;
        this._descriptorData[slot * 4 + 3] = flags;
        this._dirty = true;
        return slot;
    }

    unregisterBuffer(buffer) {
        this._assertActive('unregister a buffer');
        const slot = this._bufferMap.get(buffer);
        if (slot === undefined) return false;
        this._bufferSlots[slot] = null;
        this._bufferMap.delete(buffer);
        this._freeBufferSlots.push(slot);
        this._descriptorData.fill(0, slot * 4, slot * 4 + 4);
        this._dirty = true;
        return true;
    }

    getBufferIndex(buffer) {
        if (this._destroyed || !this._bufferMap) return -1;
        return this._bufferMap.get(buffer) ?? -1;
    }

    createBindGroupLayout() {
        const generation = this._assertActive('create a bind group layout');
        if (this._bindGroupLayout) return this._bindGroupLayout;
        if (this._layoutBuildGeneration !== null) {
            throw new Error('Bindless bind group layout creation is already in progress');
        }

        this._layoutBuildGeneration = generation;
        try {
            const layout = this._callExternal(this.device, 'createBindGroupLayout', [{
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                        sampler: { type: 'filtering' },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                        texture: { sampleType: 'float', viewDimension: '2d' },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                        buffer: { type: 'read-only-storage' },
                    },
                ],
                label: 'Bindless_Layout',
            }], generation, 'create a bind group layout');
            if (!this._bindGroupLayout) this._bindGroupLayout = layout;
            return this._bindGroupLayout;
        } finally {
            if (this._layoutBuildGeneration === generation) this._layoutBuildGeneration = null;
        }
    }

    getBindGroup() {
        const generation = this._assertActive('get a bind group');
        if (!this._dirty && this._bindGroup) return this._bindGroup;
        if (this._bindGroupBuildGeneration !== null) {
            throw new Error('Bindless bind group creation is already in progress');
        }

        this._bindGroupBuildGeneration = generation;
        try {
            const queue = this._readExternalMember(
                this.vgpu, 'queue', generation, 'resolve the descriptor upload queue',
            );
            const descriptorBuffer = this._descriptorBuffer;
            const descriptorData = this._descriptorData;
            this._callExternal(
                queue, 'writeBuffer', [descriptorBuffer, 0, descriptorData],
                generation, 'upload bindless descriptors',
            );

            const layout = Reflect.apply(
                VGPUBindless.prototype.createBindGroupLayout, this, [],
            );
            this._assertGeneration(generation, 'create a bind group');
            const bindGroup = this._callExternal(this.device, 'createBindGroup', [{
                layout,
                entries: [
                    { binding: 0, resource: this._defaultSampler },
                    { binding: 1, resource: this._textureViews[0] || this._defaultView },
                    { binding: 2, resource: { buffer: descriptorBuffer } },
                ],
                label: 'Bindless_BindGroup',
            }], generation, 'create a bind group');
            this._bindGroup = bindGroup;
            this._dirty = false;
            return bindGroup;
        } finally {
            if (this._bindGroupBuildGeneration === generation) {
                this._bindGroupBuildGeneration = null;
            }
        }
    }

    getShaderCode() {
        if (this._destroyed) return '';
        return `
// Bindless texture access helpers
// Note: True bindless requires texture_2d_array or WebGPU extensions

struct BufferDescriptor {
    offset: f32,
    size: f32,
    stride: f32,
    flags: f32,
}

@group(3) @binding(0) var bindless_sampler: sampler;
@group(3) @binding(1) var bindless_texture: texture_2d<f32>;
@group(3) @binding(2) var<storage, read> buffer_descriptors: array<BufferDescriptor>;

fn sampleBindlessTexture(uv: vec2f) -> vec4f {
    return textureSample(bindless_texture, bindless_sampler, uv);
}

fn getBufferDescriptor(index: u32) -> BufferDescriptor {
    return buffer_descriptors[index];
}
`;
    }

    getStats() {
        if (this._destroyed || !this._textureMap || !this._bufferMap) {
            return {
                texturesRegistered: 0,
                textureSlotsFree: 0,
                buffersRegistered: 0,
                bufferSlotsFree: 0,
                maxTextures: this.maxTextures,
                maxBuffers: this.maxBuffers,
            };
        }
        return {
            texturesRegistered: this._textureMap.size,
            textureSlotsFree: this._freeTextureSlots.length,
            buffersRegistered: this._bufferMap.size,
            bufferSlotsFree: this._freeBufferSlots.length,
            maxTextures: this.maxTextures,
            maxBuffers: this.maxBuffers,
        };
    }

    destroy() {
        if (this._destroyed) return false;
        const defaultTexture = this._defaultTexture;
        const descriptorBuffer = this._descriptorBuffer;

        this._destroyed = true;
        this._generation++;
        this._textureSlots?.fill(null);
        this._textureViews?.fill(null);
        this._bufferSlots?.fill(null);
        this._textureMap?.clear();
        this._bufferMap?.clear();
        this._freeTextureSlots?.splice(0);
        this._freeBufferSlots?.splice(0);
        this._descriptorData?.fill(0);
        this._textureSlots = null;
        this._textureViews = null;
        this._freeTextureSlots = null;
        this._textureMap = null;
        this._bufferSlots = null;
        this._freeBufferSlots = null;
        this._bufferMap = null;
        this._descriptorBuffer = null;
        this._descriptorData = null;
        this._bindGroup = null;
        this._bindGroupLayout = null;
        this._defaultTexture = null;
        this._defaultView = null;
        this._defaultSampler = null;
        this._layoutBuildGeneration = null;
        this._bindGroupBuildGeneration = null;
        this._dirty = false;
        this.device = null;
        this.vgpu = null;

        destroyOwned(descriptorBuffer);
        destroyOwned(defaultTexture);
        return true;
    }

    dispose() {
        return this.destroy();
    }
}
