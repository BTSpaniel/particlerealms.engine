// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU Readback Queue - Async buffer/texture reads with callbacks
 * Batches staging buffers for efficient GPU→CPU data transfer
 */

export class VGPUReadbackQueue {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this.queue = vgpu.queue;
        
        // Pending readback requests
        this._pendingBuffers = [];
        this._pendingTextures = [];
        
        // Staging buffer pool
        this._stagingPool = [];
        this._maxPoolSize = 32;
        
        // Frame tracking for batching
        this._frameRequests = [];
        this._stagingFrame = null;
        this._activeFrame = null;
        this._activeRequest = null;
        this._processingFrame = false;

        // Lifecycle fencing for mapAsync work that may never settle.
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        this._lifecycleCancellation = new Promise(resolve => {
            this._cancelLifecycleWait = resolve;
        });
    }

    /**
     * Queue a buffer read with callback
     * @param {GPUBuffer} buffer - Source buffer
     * @param {number} offset - Byte offset
     * @param {number} size - Bytes to read
     * @param {Function} callback - Called with ArrayBuffer when ready
     * @returns {number} Request ID
     */
    readBuffer(buffer, offset, size, callback) {
        this._assertAlive();
        const id = this._pendingBuffers.length;
        this._pendingBuffers.push({
            id,
            kind: 'buffer',
            buffer,
            offset: offset || 0,
            size: size || buffer.size,
            callback,
            staging: null,
            mapped: false,
            cancelled: false,
            settled: false,
        });
        return id;
    }

    /**
     * Queue a texture read with callback
     * @param {GPUTexture} texture - Source texture
     * @param {Object} options - { x, y, width, height, mipLevel }
     * @param {Function} callback - Called with { data, width, height } when ready
     */
    readTexture(texture, options, callback) {
        this._assertAlive();
        const {
            x = 0, y = 0,
            width = texture.width,
            height = texture.height,
            mipLevel = 0,
        } = options;

        const bytesPerPixel = this._getBytesPerPixel(texture.format);
        const bytesPerRow = Math.ceil(width * bytesPerPixel / 256) * 256;
        const size = bytesPerRow * height;

        const id = this._pendingTextures.length;
        this._pendingTextures.push({
            id,
            kind: 'texture',
            texture,
            x, y, width, height,
            mipLevel,
            bytesPerRow,
            size,
            callback,
            staging: null,
            mapped: false,
            cancelled: false,
            settled: false,
        });
        return id;
    }

    /**
     * Flush all pending reads (call once per frame)
     * @param {GPUCommandEncoder} encoder - Optional encoder to use
     */
    flush(encoder) {
        this._assertAlive();
        if (this._pendingBuffers.length === 0 && this._pendingTextures.length === 0) {
            return;
        }

        const frame = {
            generation: this._generation,
            buffers: this._pendingBuffers.splice(0),
            textures: this._pendingTextures.splice(0),
        };
        const ownEncoder = !encoder;
        this._stagingFrame = frame;

        try {
            if (ownEncoder) {
                encoder = this.device.createCommandEncoder({ label: 'ReadbackQueue' });
                this._assertFrameCurrent(frame);
            }

            // Process buffer reads
            for (const req of frame.buffers) {
                req.staging = this._acquireStaging(req.size);
                this._assertFrameCurrent(frame);
                encoder.copyBufferToBuffer(req.buffer, req.offset, req.staging, 0, req.size);
                this._assertFrameCurrent(frame);
            }

            // Process texture reads
            for (const req of frame.textures) {
                req.staging = this._acquireStaging(req.size);
                this._assertFrameCurrent(frame);
                encoder.copyTextureToBuffer(
                    { texture: req.texture, mipLevel: req.mipLevel, origin: { x: req.x, y: req.y } },
                    { buffer: req.staging, bytesPerRow: req.bytesPerRow },
                    { width: req.width, height: req.height }
                );
                this._assertFrameCurrent(frame);
            }

            if (ownEncoder) {
                const commandBuffer = encoder.finish();
                this._assertFrameCurrent(frame);
                this.queue.submit([commandBuffer]);
                this._assertFrameCurrent(frame);
            }

            this._frameRequests.push(frame);
            this._stagingFrame = null;

            // Process callbacks asynchronously
            this._processCallbacks();
        } catch (error) {
            if (this._stagingFrame === frame) this._stagingFrame = null;
            this._cancelRequests([...frame.buffers, ...frame.textures], error);
            throw error;
        }
    }

    async _processCallbacks() {
        if (this._destroyed || this._processingFrame || this._frameRequests.length === 0) return;
        this._processingFrame = true;
        const frame = this._frameRequests.shift();
        const generation = frame.generation;
        this._activeFrame = frame;

        try {
            for (const req of [...frame.buffers, ...frame.textures]) {
                if (!this._isFrameCurrent(frame, generation)) break;
                this._activeRequest = req;
                await this._processRequest(req, frame, generation);
                if (this._activeRequest === req) this._activeRequest = null;
            }
        } finally {
            if (this._activeRequest && this._activeFrame === frame) this._activeRequest = null;
            if (this._activeFrame === frame) this._activeFrame = null;
            if (this._generation === generation && !this._destroyed) {
                this._processingFrame = false;
                if (this._frameRequests.length > 0) this._processCallbacks();
            }
        }
    }

    async _processRequest(req, frame, generation) {
        const staging = req.staging;
        if (!staging || !this._isRequestCurrent(req, frame, generation, staging)) return;

        const mapOutcome = Promise.resolve()
            .then(() => staging.mapAsync(GPUMapMode.READ))
            .then(
                () => ({ status: 'mapped' }),
                error => ({ status: 'failed', error })
            );

        try {
            const outcome = await Promise.race([
                mapOutcome,
                this._lifecycleCancellation.then(error => ({ status: 'cancelled', error })),
            ]);
            if (outcome.status !== 'mapped') throw outcome.error;
            if (!this._isRequestCurrent(req, frame, generation, staging)) {
                throw this._destroyError || this._createCancellationError('generation invalidated');
            }

            req.mapped = true;
            const mappedCopy = staging.getMappedRange().slice(0);
            if (!this._isRequestCurrent(req, frame, generation, staging)) {
                throw this._destroyError || this._createCancellationError('generation invalidated');
            }

            const value = req.kind === 'texture'
                ? {
                    data: new Uint8Array(mappedCopy),
                    width: req.width,
                    height: req.height,
                    bytesPerRow: req.bytesPerRow,
                }
                : mappedCopy;
            this._retireRequestStaging(req, true);
            if (!this._isRequestCurrent(req, frame, generation, null)) {
                throw this._destroyError || this._createCancellationError('generation invalidated');
            }
            this._settleRequest(req, value, null);
        } catch (error) {
            this._retireRequestStaging(req, false);
            if (!req.cancelled && !this._destroyed) {
                console.error(`[ReadbackQueue] ${req.kind === 'texture' ? 'Texture' : 'Buffer'} read failed:`, error);
            }
            this._settleRequest(req, null, error);
        }
    }

    _assertAlive() {
        if (this._destroyed) {
            throw this._destroyError || this._createCancellationError('destroyed');
        }
    }

    _assertFrameCurrent(frame) {
        if (!this._isFrameCurrent(frame, frame.generation)) {
            throw this._destroyError || this._createCancellationError('generation invalidated');
        }
    }

    _isFrameCurrent(frame, generation) {
        if (!frame || this._destroyed || generation !== this._generation || frame.generation !== generation) {
            return false;
        }
        return this._stagingFrame === frame
            || this._activeFrame === frame
            || this._frameRequests.includes(frame);
    }

    _isRequestCurrent(req, frame, generation, staging) {
        return this._isFrameCurrent(frame, generation)
            && this._activeFrame === frame
            && this._activeRequest === req
            && !req.cancelled
            && !req.settled
            && req.staging === staging;
    }

    _createCancellationError(reason) {
        const error = new Error(`GPU readback queue ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_READBACK_CANCELLED';
        return error;
    }

    _settleRequest(req, value, error) {
        if (!req || req.settled) return false;
        req.settled = true;
        if (typeof req.callback !== 'function') return true;
        try {
            if (error) req.callback(null, error);
            else req.callback(value);
        } catch (callbackError) {
            console.error('[ReadbackQueue] Callback failed:', callbackError);
        }
        return true;
    }

    _retireRequestStaging(req, allowPool) {
        if (!req) return;
        const staging = req.staging;
        const wasMapped = req.mapped;
        req.staging = null;
        req.mapped = false;
        if (!staging) return;

        let reusable = Boolean(allowPool) && !this._destroyed;
        if (wasMapped) {
            try {
                staging.unmap();
            } catch (_) {
                reusable = false;
            }
        }
        if (reusable) this._releaseStaging(staging);
        else this._destroyStaging(staging);
    }

    _destroyStaging(staging) {
        if (!staging) return;
        try { staging.destroy(); } catch (error) {
            console.warn('[ReadbackQueue] Failed to destroy staging buffer:', error);
        }
    }

    _cancelRequests(requests, error, settle = true) {
        const unique = [...new Set(requests.filter(Boolean))].filter(req => !req.settled);
        for (const req of unique) {
            req.cancelled = true;
            this._retireRequestStaging(req, false);
        }
        if (settle) {
            for (const req of unique) this._settleRequest(req, null, error);
        }
        return unique;
    }

    _acquireStaging(size) {
        // Find a suitable staging buffer from pool
        for (let i = 0; i < this._stagingPool.length; i++) {
            if (this._stagingPool[i].size >= size) {
                return this._stagingPool.splice(i, 1)[0];
            }
        }

        // Create new staging buffer
        return this.device.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: 'ReadbackStaging',
        });
    }

    _releaseStaging(buffer) {
        if (!this._destroyed && this._stagingPool.length < this._maxPoolSize) {
            this._stagingPool.push(buffer);
        } else {
            this._destroyStaging(buffer);
        }
    }

    _getBytesPerPixel(format) {
        const bpp = {
            'r8unorm': 1, 'r8snorm': 1, 'r8uint': 1, 'r8sint': 1,
            'rg8unorm': 2, 'rg8snorm': 2, 'rg8uint': 2, 'rg8sint': 2,
            'rgba8unorm': 4, 'rgba8snorm': 4, 'rgba8uint': 4, 'rgba8sint': 4,
            'bgra8unorm': 4, 'rgba16float': 8, 'rgba32float': 16,
            'r16float': 2, 'rg16float': 4, 'r32float': 4, 'rg32float': 8,
        };
        return bpp[format] || 4;
    }

    /**
     * Get pending request count
     */
    getPendingCount() {
        const requests = new Set([...this._pendingBuffers, ...this._pendingTextures]);
        for (const frame of [this._stagingFrame, this._activeFrame, ...this._frameRequests]) {
            if (!frame) continue;
            for (const req of [...frame.buffers, ...frame.textures]) requests.add(req);
        }
        if (this._activeRequest) requests.add(this._activeRequest);
        return [...requests].filter(req => !req.settled).length;
    }

    destroy(reason = 'destroyed') {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation += 1;
        const error = this._createCancellationError(reason);
        this._destroyError = error;

        const frames = [this._stagingFrame, this._activeFrame, ...this._frameRequests];
        const requests = [...this._pendingBuffers, ...this._pendingTextures];
        for (const frame of frames) {
            if (frame) requests.push(...frame.buffers, ...frame.textures);
        }
        if (this._activeRequest) requests.push(this._activeRequest);

        this._pendingBuffers = [];
        this._pendingTextures = [];
        this._frameRequests = [];
        this._stagingFrame = null;
        this._activeFrame = null;
        this._activeRequest = null;
        this._processingFrame = false;

        // Retire every GPU local before user callbacks can re-enter the queue.
        const cancelled = this._cancelRequests(requests, error, false);
        const pooled = this._stagingPool.splice(0);
        for (const staging of pooled) this._destroyStaging(staging);

        this._cancelLifecycleWait(error);
        for (const req of cancelled) this._settleRequest(req, null, error);
        return true;
    }
}
