// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Texture Atlas Manager - Dynamic packing for sprites/UI, automatic UV remapping
 */

import {
    atlasContentRect,
    atlasPaddedArea,
    atlasPaddedExtent,
    atlasPaddedRectFromContent,
    atlasRegionUVs,
} from '../math/TextureMath.js';
import { allocateBestAreaRectangle } from '../math/RectanglePacking.js';

function invalidHostMethodError(ownerName, methodName) {
    const error = new TypeError(`[${ownerName}] Host method ${methodName} is not callable`);
    error.code = 'VGPU_HOST_METHOD_INVALID';
    return error;
}

function captureHostProperty(receiver, propertyName, assertCurrent, stageResult = null) {
    assertCurrent();
    let value;
    try {
        value = receiver[propertyName];
    } catch (error) {
        assertCurrent();
        throw error;
    }
    if (stageResult) stageResult(value);
    assertCurrent();
    return value;
}

function captureHostMethod(receiver, methodName, assertCurrent, ownerName, stageResult = null) {
    const method = captureHostProperty(receiver, methodName, assertCurrent, stageResult);
    if (typeof method !== 'function') throw invalidHostMethodError(ownerName, methodName);
    assertCurrent();
    return method;
}

function invokeCapturedHostMethod(receiver, method, args, assertCurrent, stageResult = null) {
    assertCurrent();
    let result;
    try {
        result = Reflect.apply(method, receiver, args);
    } catch (error) {
        assertCurrent();
        throw error;
    }
    if (stageResult) stageResult(result);
    assertCurrent();
    return result;
}

function invokeHostMethod(receiver, methodName, args, assertCurrent, ownerName, stageResult = null) {
    const method = captureHostMethod(receiver, methodName, assertCurrent, ownerName);
    return invokeCapturedHostMethod(receiver, method, args, assertCurrent, stageResult);
}

function retireDestroyable(resource, destroyMethod, retiredResources) {
    if (!resource || retiredResources.has(resource)) return false;
    retiredResources.add(resource);
    let method = destroyMethod;
    if (typeof method !== 'function') {
        try { method = resource.destroy; } catch (_) { return false; }
    }
    if (typeof method !== 'function') return false;
    try { Reflect.apply(method, resource, []); } catch (_) {}
    return true;
}

function releaseManagedId(bufferManager, releaseMethod, id, retiredIds) {
    if (id === null || id === undefined || retiredIds.has(id)) return false;
    let method = releaseMethod;
    if (typeof method !== 'function') {
        try { method = bufferManager?.release; } catch (_) { return false; }
    }
    if (typeof method !== 'function') return false;
    retiredIds.add(id);
    try { Reflect.apply(method, bufferManager, [id]); } catch (_) {}
    return true;
}

function allocationId(allocation) {
    if (!allocation) return null;
    try { return allocation.id; } catch (_) { return null; }
}

export class VGPUTextureAtlas {
    constructor(vgpu, options = {}) {
        this.vgpu = vgpu;
        const parentFactoryGeneration = vgpu?._factoryGeneration;
        this._parentFactoryGeneration = Number.isSafeInteger(parentFactoryGeneration)
            ? parentFactoryGeneration
            : null;
        this.device = vgpu.device;

        this.width = options.width || 2048;
        this.height = options.height || 2048;
        this.format = options.format || 'rgba8unorm';
        const padding = Number(options.padding ?? 2);
        this.padding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 2;
        this.maxTextures = options.maxTextures || 256;

        this._texture = null;
        this._view = null;
        this._regions = new Map();  // name -> { x, y, w, h, uvs }
        this._freeRects = [];
        this._dirty = false;
        this._nextId = 0;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        this._textureOperation = null;
        this._textureDestroyMethod = null;
        this._retiredTextures = new WeakSet();
        this._uvOperation = null;

        this._init();
    }

    _init() {
        const generation = this._generation;
        const operation = {
            generation,
            texture: null,
            destroyMethod: null,
            view: null,
            retired: false,
            retiredResources: new WeakSet(),
        };
        this._textureOperation = operation;
        const assertCurrent = () => this._assertTextureOperationCurrent(operation);
        try {
            const device = this.device;
            assertCurrent();
            const texture = invokeHostMethod(device, 'createTexture', [{
                size: { width: this.width, height: this.height },
                format: this.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                label: 'TextureAtlas',
            }], assertCurrent, 'TextureAtlas', candidate => { operation.texture = candidate; });
            const destroyMethod = captureHostMethod(
                texture,
                'destroy',
                assertCurrent,
                'TextureAtlas',
                method => {
                    operation.texture = texture;
                    operation.destroyMethod = method;
                },
            );
            const createView = captureHostMethod(
                texture,
                'createView',
                assertCurrent,
                'TextureAtlas',
            );
            const view = invokeCapturedHostMethod(
                texture,
                createView,
                [],
                assertCurrent,
                candidate => { operation.view = candidate; },
            );

            this._texture = operation.texture;
            this._view = operation.view;
            this._textureDestroyMethod = destroyMethod;
            this._freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
            operation.texture = null;
            operation.destroyMethod = null;
            operation.view = null;
            operation.retired = true;
            if (this._textureOperation === operation) this._textureOperation = null;
        } catch (error) {
            this._retireTextureOperation(operation);
            this._assertGeneration(generation);
            throw error;
        }
    }

    _assertTextureOperationCurrent(operation) {
        this._assertGeneration(operation.generation);
        if (this._textureOperation !== operation || operation.retired) {
            throw this._destroyError || this._lifecycleError('texture operation invalidated');
        }
    }

    /**
     * Add a texture to the atlas
     * @param {string} name - Unique name for this region
     * @param {ImageBitmap|HTMLCanvasElement|ImageData|TypedArray} source - Image data
     * @param {number} width - Source width
     * @param {number} height - Source height
     * @returns {Object|null} Region info { x, y, w, h, uvs } or null if no space
     */
    add(name, source, width, height) {
        this._assertAlive();
        const generation = this._generation;
        if (this._regions.has(name)) {
            console.warn(`[TextureAtlas] Region already exists: ${name}`);
            return this._regions.get(name);
        }

        const padded = atlasPaddedExtent(width, height, this.padding);
        const paddedW = padded.width;
        const paddedH = padded.height;

        // Find best fit using MaxRects algorithm
        const previousFreeRects = this._freeRects.map(rect => ({ ...rect }));
        const rect = this._findBestRect(paddedW, paddedH);
        if (!rect) {
            console.error(`[TextureAtlas] No space for ${name} (${width}x${height})`);
            return null;
        }

        // Calculate actual position (with padding offset)
        const content = atlasContentRect(rect.x, rect.y, width, height, this.padding);
        const x = content.x;
        const y = content.y;

        try {
            // Upload texture data before publishing packing metadata.
            this._uploadRegion(source, x, y, width, height, generation);
            this._assertGeneration(generation);
        } catch (error) {
            if (!this._destroyed && generation === this._generation) {
                this._freeRects = previousFreeRects;
            }
            this._assertGeneration(generation);
            throw error;
        }

        // Calculate UVs
        const uvs = atlasRegionUVs(x, y, width, height, this.width, this.height);

        const region = { x, y, w: width, h: height, uvs, id: this._nextId++ };
        this._regions.set(name, region);
        this._dirty = true;

        return region;
    }

    /**
     * Add multiple textures efficiently (batch upload)
     * @param {Array<{name, source, width, height}>} textures
     * @returns {Map<string, Object>} Map of name -> region
     */
    addBatch(textures) {
        this._assertAlive();
        const generation = this._generation;
        const results = new Map();

        // Sort by height (better packing)
        const sorted = [...textures].sort((a, b) => b.height - a.height);
        this._assertGeneration(generation);

        for (const { name, source, width, height } of sorted) {
            const region = this.add(name, source, width, height);
            if (region) {
                results.set(name, region);
            }
        }

        return results;
    }

    /**
     * Remove a texture from the atlas
     * @param {string} name - Region name
     */
    remove(name) {
        this._assertAlive();
        const region = this._regions.get(name);
        if (!region) return;

        // Add back to free rects
        const padded = atlasPaddedRectFromContent(region.x, region.y, region.w, region.h, this.padding);
        this._freeRects.push({
            x: padded.x,
            y: padded.y,
            w: padded.width,
            h: padded.height,
        });

        this._regions.delete(name);
        this._mergeRects();
        this._dirty = true;
    }

    /**
     * Get region info by name
     */
    get(name) {
        this._assertAlive();
        return this._regions.get(name);
    }

    /**
     * Get UV coordinates for a region
     */
    getUVs(name) {
        this._assertAlive();
        return this._regions.get(name)?.uvs;
    }

    /**
     * Get the atlas texture
     */
    getTexture() {
        this._assertAlive();
        return this._texture;
    }

    /**
     * Get the atlas texture view
     */
    getView() {
        this._assertAlive();
        return this._view;
    }

    /**
     * Check if region exists
     */
    has(name) {
        this._assertAlive();
        return this._regions.has(name);
    }

    /**
     * Get all region names
     */
    getRegionNames() {
        this._assertAlive();
        return Array.from(this._regions.keys());
    }

    /**
     * Generate UV buffer for a list of region names
     * @param {string[]} names - Region names in order
     * @returns {Float32Array} UV data (u0, v0, u1, v1 per region)
     */
    generateUVBuffer(names) {
        this._assertAlive();
        const data = new Float32Array(names.length * 4);
        for (let i = 0; i < names.length; i++) {
            const region = this._regions.get(names[i]);
            if (region) {
                data[i * 4 + 0] = region.uvs.u0;
                data[i * 4 + 1] = region.uvs.v0;
                data[i * 4 + 2] = region.uvs.u1;
                data[i * 4 + 3] = region.uvs.v1;
            }
        }
        return data;
    }

    /**
     * Create a GPU buffer with UV data for all regions
     */
    createUVBuffer() {
        this._assertAlive();
        const generation = this._generation;
        const names = this.getRegionNames();
        const data = this.generateUVBuffer(names);
        const operation = {
            generation,
            bufferManager: null,
            createMethod: null,
            releaseMethod: null,
            allocation: null,
            id: null,
            buffer: null,
            retired: false,
            retiredIds: new Set(),
        };
        this._uvOperation = operation;
        const assertCurrent = () => this._assertUVOperationCurrent(operation);
        try {
            const vgpu = this.vgpu;
            assertCurrent();
            const bufferManager = captureHostProperty(
                vgpu,
                'buffer',
                assertCurrent,
                candidate => { operation.bufferManager = candidate; },
            );
            const createMethod = captureHostMethod(
                bufferManager,
                'create',
                assertCurrent,
                'TextureAtlas',
                method => { operation.createMethod = method; },
            );
            captureHostMethod(
                bufferManager,
                'release',
                assertCurrent,
                'TextureAtlas',
                method => { operation.releaseMethod = method; },
            );
            const allocation = invokeCapturedHostMethod(bufferManager, createMethod, [{
                size: data.byteLength,
                usage: 'storage',
                data: data,
                label: 'AtlasUVs',
            }], assertCurrent, candidate => { operation.allocation = candidate; });
            captureHostProperty(
                allocation,
                'id',
                assertCurrent,
                id => {
                    operation.allocation = allocation;
                    operation.id = id;
                },
            );
            captureHostProperty(
                allocation,
                'buffer',
                assertCurrent,
                buffer => {
                    operation.allocation = allocation;
                    operation.buffer = buffer;
                },
            );
            operation.allocation = null;
            operation.id = null;
            operation.buffer = null;
            operation.retired = true;
            if (this._uvOperation === operation) this._uvOperation = null;
            return allocation;
        } catch (error) {
            this._retireUVOperation(operation);
            this._assertGeneration(generation);
            throw error;
        }
    }

    _assertUVOperationCurrent(operation) {
        this._assertGeneration(operation.generation);
        if (this._uvOperation !== operation || operation.retired) {
            throw this._destroyError || this._lifecycleError('UV allocation invalidated');
        }
    }

    _findBestRect(w, h) {
        return allocateBestAreaRectangle(this._freeRects, w, h);
    }

    _mergeRects() {
        // Simple merge pass - combine adjacent rectangles
        let merged = true;
        while (merged) {
            merged = false;
            for (let i = 0; i < this._freeRects.length && !merged; i++) {
                for (let j = i + 1; j < this._freeRects.length && !merged; j++) {
                    const a = this._freeRects[i];
                    const b = this._freeRects[j];

                    // Check horizontal merge
                    if (a.y === b.y && a.h === b.h && a.x + a.w === b.x) {
                        a.w += b.w;
                        this._freeRects.splice(j, 1);
                        merged = true;
                    }
                    // Check vertical merge
                    else if (a.x === b.x && a.w === b.w && a.y + a.h === b.y) {
                        a.h += b.h;
                        this._freeRects.splice(j, 1);
                        merged = true;
                    }
                }
            }
        }
    }

    _uploadRegion(source, x, y, width, height, generation = this._generation) {
        const assertCurrent = () => this._assertGeneration(generation);
        assertCurrent();
        const isExternalImage = source instanceof ImageBitmap || source instanceof HTMLCanvasElement;
        const isImageData = source instanceof ImageData;
        const isArrayView = ArrayBuffer.isView(source);
        if (!isExternalImage && !isImageData && !isArrayView) return;
        const vgpu = this.vgpu;
        assertCurrent();
        const queue = captureHostProperty(vgpu, 'queue', assertCurrent);
        const texture = this._texture;
        assertCurrent();
        if (isExternalImage) {
            invokeHostMethod(queue, 'copyExternalImageToTexture', [
                { source },
                { texture, origin: { x, y } },
                { width, height },
            ], assertCurrent, 'TextureAtlas');
        } else if (isImageData) {
            const data = captureHostProperty(source, 'data', assertCurrent);
            invokeHostMethod(queue, 'writeTexture', [
                { texture, origin: { x, y } },
                data,
                { bytesPerRow: width * 4 },
                { width, height },
            ], assertCurrent, 'TextureAtlas');
        } else if (isArrayView) {
            const bytesPerPixel = this._getBytesPerPixel();
            assertCurrent();
            invokeHostMethod(queue, 'writeTexture', [
                { texture, origin: { x, y } },
                source,
                { bytesPerRow: width * bytesPerPixel },
                { width, height },
            ], assertCurrent, 'TextureAtlas');
        }
    }

    _getBytesPerPixel() {
        const bpp = {
            'rgba8unorm': 4, 'bgra8unorm': 4,
            'rgba16float': 8, 'rgba32float': 16,
        };
        return bpp[this.format] || 4;
    }

    /**
     * Get atlas utilization stats
     */
    getStats() {
        this._assertAlive();
        let usedArea = 0;
        for (const region of this._regions.values()) {
            usedArea += atlasPaddedArea(region.w, region.h, this.padding);
        }
        const totalArea = this.width * this.height;

        return {
            regions: this._regions.size,
            freeRects: this._freeRects.length,
            usedArea,
            totalArea,
            utilization: (usedArea / totalArea * 100).toFixed(1) + '%',
        };
    }

    /**
     * Clear the atlas
     */
    clear() {
        this._assertAlive();
        this._regions.clear();
        this._freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
        this._dirty = true;
    }

    _retireTextureOperation(operation) {
        if (!operation) return false;
        const firstRetirement = !operation.retired;
        operation.retired = true;
        if (this._textureOperation === operation) this._textureOperation = null;
        const texture = operation.texture;
        const destroyMethod = operation.destroyMethod;
        operation.texture = null;
        operation.destroyMethod = null;
        operation.view = null;
        const retired = retireDestroyable(texture, destroyMethod, operation.retiredResources);
        return firstRetirement || retired;
    }

    _retireUVOperation(operation) {
        if (!operation) return false;
        const firstRetirement = !operation.retired;
        operation.retired = true;
        if (this._uvOperation === operation) this._uvOperation = null;
        const allocation = operation.allocation;
        const id = operation.id ?? allocationId(allocation);
        operation.allocation = null;
        operation.id = null;
        operation.buffer = null;
        const released = releaseManagedId(
            operation.bufferManager,
            operation.releaseMethod,
            id,
            operation.retiredIds,
        );
        return firstRetirement || released;
    }

    _lifecycleError(reason = 'destroyed') {
        const error = new Error(`[TextureAtlas] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_TEXTURE_ATLAS_DESTROYED';
        return error;
    }

    _parentInvalidated() {
        return this.vgpu?._destroyed === true
            || (this._parentFactoryGeneration !== null
                && this.vgpu?._factoryGeneration !== this._parentFactoryGeneration);
    }

    _assertAlive() {
        if (!this._destroyed && this._parentInvalidated()) this.destroy();
        if (this._destroyed) throw this._destroyError || this._lifecycleError();
    }

    _assertGeneration(generation) {
        this._assertAlive();
        if (generation !== this._generation) {
            throw this._destroyError || this._lifecycleError('generation invalidated');
        }
    }

    destroy() {
        if (this._destroyed) return false;
        const textureOperation = this._textureOperation;
        const uvOperation = this._uvOperation;
        this._textureOperation = null;
        this._uvOperation = null;
        this._destroyed = true;
        this._generation++;
        this._destroyError = this._lifecycleError();
        this._retireTextureOperation(textureOperation);
        this._retireUVOperation(uvOperation);
        const texture = this._texture;
        const textureDestroyMethod = this._textureDestroyMethod;
        this._texture = null;
        this._view = null;
        this._textureDestroyMethod = null;
        this._regions.clear();
        this._freeRects = [];
        this._dirty = false;
        retireDestroyable(texture, textureDestroyMethod, this._retiredTextures);
        return true;
    }
}

/**
 * Sprite batch renderer using texture atlas
 */
export class VGPUSpriteBatch {
    constructor(vgpu, atlas) {
        this.vgpu = vgpu;
        this.atlas = atlas;
        this.maxSprites = 10000;

        this._vertices = new Float32Array(this.maxSprites * 4 * 4); // 4 verts, 4 floats each (x,y,u,v)
        this._indices = null;
        this._vertexBuffer = null;
        this._vertexBufferId = null;
        this._indexBuffer = null;
        this._indexBufferId = null;
        this._spriteCount = 0;
        this._pipeline = null;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        const parentFactoryGeneration = vgpu?._factoryGeneration;
        this._parentFactoryGeneration = Number.isSafeInteger(parentFactoryGeneration)
            ? parentFactoryGeneration
            : null;
        this._bufferOperation = null;
        this._bufferManager = null;
        this._releaseBufferMethod = null;
        this._releasedBufferIds = new Set();

        this._init();
    }

    _init() {
        // Create index buffer (shared for all quads)
        const indices = new Uint16Array(this.maxSprites * 6);
        for (let i = 0; i < this.maxSprites; i++) {
            const v = i * 4;
            const idx = i * 6;
            indices[idx + 0] = v + 0;
            indices[idx + 1] = v + 1;
            indices[idx + 2] = v + 2;
            indices[idx + 3] = v + 2;
            indices[idx + 4] = v + 3;
            indices[idx + 5] = v + 0;
        }

        const generation = this._generation;
        const operation = {
            generation,
            bufferManager: null,
            createMethod: null,
            releaseMethod: null,
            indexAllocation: null,
            indexId: null,
            indexBuffer: null,
            vertexAllocation: null,
            vertexId: null,
            vertexBuffer: null,
            retired: false,
            retiredIds: new Set(),
        };
        this._bufferOperation = operation;
        const assertCurrent = () => this._assertBufferOperationCurrent(operation);
        try {
            const vgpu = this.vgpu;
            assertCurrent();
            const bufferManager = captureHostProperty(
                vgpu,
                'buffer',
                assertCurrent,
                candidate => { operation.bufferManager = candidate; },
            );
            const createMethod = captureHostMethod(
                bufferManager,
                'create',
                assertCurrent,
                'SpriteBatch',
                method => { operation.createMethod = method; },
            );
            const releaseMethod = captureHostMethod(
                bufferManager,
                'release',
                assertCurrent,
                'SpriteBatch',
                method => { operation.releaseMethod = method; },
            );
            const indexAllocation = invokeCapturedHostMethod(bufferManager, createMethod, [{
                size: indices.byteLength,
                usage: 'index',
                data: indices,
                label: 'SpriteBatch_Index',
            }], assertCurrent, candidate => { operation.indexAllocation = candidate; });
            captureHostProperty(
                indexAllocation,
                'id',
                assertCurrent,
                id => {
                    operation.indexAllocation = indexAllocation;
                    operation.indexId = id;
                },
            );
            captureHostProperty(
                indexAllocation,
                'buffer',
                assertCurrent,
                buffer => {
                    operation.indexAllocation = indexAllocation;
                    operation.indexBuffer = buffer;
                },
            );

            const vertexAllocation = invokeCapturedHostMethod(bufferManager, createMethod, [{
                size: this._vertices.byteLength,
                usage: 'vertex',
                label: 'SpriteBatch_Vertex',
            }], assertCurrent, candidate => { operation.vertexAllocation = candidate; });
            captureHostProperty(
                vertexAllocation,
                'id',
                assertCurrent,
                id => {
                    operation.vertexAllocation = vertexAllocation;
                    operation.vertexId = id;
                },
            );
            captureHostProperty(
                vertexAllocation,
                'buffer',
                assertCurrent,
                buffer => {
                    operation.vertexAllocation = vertexAllocation;
                    operation.vertexBuffer = buffer;
                },
            );

            assertCurrent();
            this._indexBuffer = operation.indexBuffer;
            this._indexBufferId = operation.indexId;
            this._vertexBuffer = operation.vertexBuffer;
            this._vertexBufferId = operation.vertexId;
            this._bufferManager = bufferManager;
            this._releaseBufferMethod = releaseMethod;
            operation.indexAllocation = null;
            operation.indexId = null;
            operation.indexBuffer = null;
            operation.vertexAllocation = null;
            operation.vertexId = null;
            operation.vertexBuffer = null;
            operation.retired = true;
            if (this._bufferOperation === operation) this._bufferOperation = null;
        } catch (error) {
            this._retireBufferOperation(operation);
            this._assertGeneration(generation);
            throw error;
        }
    }

    _assertBufferOperationCurrent(operation) {
        this._assertGeneration(operation.generation);
        if (this._bufferOperation !== operation || operation.retired) {
            throw this._destroyError || this._lifecycleError('buffer operation invalidated');
        }
    }

    begin() {
        this._assertAlive();
        this._spriteCount = 0;
    }

    draw(regionName, x, y, width, height, options = {}) {
        this._assertAlive();
        const generation = this._generation;
        if (this._spriteCount >= this.maxSprites) {
            console.warn('[SpriteBatch] Max sprites reached');
            return;
        }

        const region = this.atlas.get(regionName);
        this._assertGeneration(generation);
        if (!region) return;

        const { rotation = 0, scaleX = 1, scaleY = 1, originX = 0, originY = 0 } = options;
        const uvs = region.uvs;

        const w = (width ?? region.w) * scaleX;
        const h = (height ?? region.h) * scaleY;

        let x0 = -originX * w;
        let y0 = -originY * h;
        let x1 = x0 + w;
        let y1 = y0 + h;

        // Apply rotation
        if (rotation !== 0) {
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const corners = [
                { x: x0, y: y0 }, { x: x1, y: y0 },
                { x: x1, y: y1 }, { x: x0, y: y1 },
            ];
            for (const c of corners) {
                const rx = c.x * cos - c.y * sin;
                const ry = c.x * sin + c.y * cos;
                c.x = rx + x;
                c.y = ry + y;
            }
            this._writeQuad(corners, uvs, generation);
        } else {
            this._writeQuad([
                { x: x + x0, y: y + y0 },
                { x: x + x1, y: y + y0 },
                { x: x + x1, y: y + y1 },
                { x: x + x0, y: y + y1 },
            ], uvs, generation);
        }

        this._assertGeneration(generation);
        this._spriteCount++;
    }

    _writeQuad(corners, uvs, generation = this._generation) {
        this._assertGeneration(generation);
        const offset = this._spriteCount * 16;
        const v = this._vertices;

        v[offset + 0] = corners[0].x; v[offset + 1] = corners[0].y;
        v[offset + 2] = uvs.u0; v[offset + 3] = uvs.v0;

        v[offset + 4] = corners[1].x; v[offset + 5] = corners[1].y;
        v[offset + 6] = uvs.u1; v[offset + 7] = uvs.v0;

        v[offset + 8] = corners[2].x; v[offset + 9] = corners[2].y;
        v[offset + 10] = uvs.u1; v[offset + 11] = uvs.v1;

        v[offset + 12] = corners[3].x; v[offset + 13] = corners[3].y;
        v[offset + 14] = uvs.u0; v[offset + 15] = uvs.v1;
        this._assertGeneration(generation);
    }

    end() {
        this._assertAlive();
        if (this._spriteCount === 0) return;
        const generation = this._generation;
        const assertCurrent = () => this._assertGeneration(generation);
        const vgpu = this.vgpu;
        assertCurrent();
        const queue = captureHostProperty(vgpu, 'queue', assertCurrent);
        const vertexBuffer = this._vertexBuffer;
        const vertices = this._vertices;
        const spriteCount = this._spriteCount;
        assertCurrent();

        // Upload vertex data
        invokeHostMethod(queue, 'writeBuffer', [
            vertexBuffer, 0,
            vertices, 0,
            spriteCount * 16,
        ], assertCurrent, 'SpriteBatch');
    }

    getSpriteCount() {
        this._assertAlive();
        return this._spriteCount;
    }

    getVertexBuffer() {
        this._assertAlive();
        return this._vertexBuffer;
    }

    getIndexBuffer() {
        this._assertAlive();
        return this._indexBuffer;
    }

    _retireBufferOperation(operation) {
        if (!operation) return false;
        const firstRetirement = !operation.retired;
        operation.retired = true;
        if (this._bufferOperation === operation) this._bufferOperation = null;
        const ids = new Set([
            operation.vertexId,
            operation.indexId,
            allocationId(operation.vertexAllocation),
            allocationId(operation.indexAllocation),
        ].filter(id => id !== null && id !== undefined));
        operation.vertexAllocation = null;
        operation.vertexId = null;
        operation.vertexBuffer = null;
        operation.indexAllocation = null;
        operation.indexId = null;
        operation.indexBuffer = null;
        let released = false;
        for (const id of ids) {
            released = releaseManagedId(
                operation.bufferManager,
                operation.releaseMethod,
                id,
                operation.retiredIds,
            ) || released;
        }
        return firstRetirement || released;
    }

    _lifecycleError(reason = 'destroyed') {
        const error = new Error(`[SpriteBatch] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_SPRITE_BATCH_DESTROYED';
        return error;
    }

    _parentInvalidated() {
        return this.vgpu?._destroyed === true
            || (this._parentFactoryGeneration !== null
                && this.vgpu?._factoryGeneration !== this._parentFactoryGeneration);
    }

    _assertAlive() {
        if (!this._destroyed && this._parentInvalidated()) this.destroy();
        if (this._destroyed) throw this._destroyError || this._lifecycleError();
    }

    _assertGeneration(generation) {
        this._assertAlive();
        if (generation !== this._generation) {
            throw this._destroyError || this._lifecycleError('generation invalidated');
        }
    }

    destroy() {
        if (this._destroyed) return false;
        const bufferOperation = this._bufferOperation;
        this._bufferOperation = null;
        this._destroyed = true;
        this._generation++;
        this._destroyError = this._lifecycleError();
        this._retireBufferOperation(bufferOperation);
        const ids = new Set([
            this._vertexBufferId,
            this._indexBufferId,
        ].filter(id => id !== null && id !== undefined));
        const bufferManager = this._bufferManager;
        const releaseMethod = this._releaseBufferMethod;
        this._vertexBuffer = null;
        this._vertexBufferId = null;
        this._indexBuffer = null;
        this._indexBufferId = null;
        this._bufferManager = null;
        this._releaseBufferMethod = null;
        this._spriteCount = 0;
        this._pipeline = null;
        for (const id of ids) {
            releaseManagedId(bufferManager, releaseMethod, id, this._releasedBufferIds);
        }
        return true;
    }
}
