// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Virtual Texturing System - On-demand texture streaming
 * Megatexture/Sparse Virtual Texture implementation
 * Used for massive open worlds with unlimited texture detail
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { SparsePageRuntime } from '../../core/gpu/SparsePageRuntime.js';
import {
    compactVirtualTextureFeedback,
    virtualTextureFeedbackBufferLayout,
    virtualTexturePageCoord,
    virtualTexturePageGrid,
    virtualTexturePageId,
    virtualTexturePageTableEntry,
    virtualTexturePhysicalPageGrid,
    virtualTexturePhysicalPageOrigin,
} from '../../core/math/TextureMath.js';

export class VirtualTexturingSystem {
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.pageSize = options.pageSize || 256; // Texture page size
        this.cacheSize = options.cacheSize || 4096; // Physical cache size
        if (!Number.isInteger(this.pageSize) || this.pageSize < 64 || this.pageSize % 64 !== 0) {
            throw new RangeError('VirtualTexturing pageSize must be an integer multiple of 64 pixels');
        }
        if (!Number.isInteger(this.cacheSize) || this.cacheSize < this.pageSize || this.cacheSize % this.pageSize !== 0) {
            throw new RangeError('VirtualTexturing cacheSize must be an integer multiple of pageSize');
        }
        this.maxMipLevels = options.maxMipLevels || 12;
        this.maxFeedbackRequests = Math.max(1, Math.floor(Number(options.maxFeedbackRequests ?? 10000)));
        this.cacheFormat = options.cacheFormat ?? 'rgba8unorm';
        if (!['rgba8unorm', 'rgba8unorm-srgb'].includes(this.cacheFormat)) {
            throw new RangeError('VirtualTexturing cacheFormat must be rgba8unorm or rgba8unorm-srgb for byte-page uploads');
        }
        this.feedbackRingSize = Math.max(2, Math.min(8, Math.floor(Number(options.feedbackRingSize ?? 3))));
        this.maxConcurrentLoads = Math.max(1, Math.min(32, Math.floor(Number(options.maxConcurrentLoads ?? 4))));

        const pageGrid = virtualTexturePageGrid(
            options.pageTableWidth || options.pageTableSize || 2048,
            options.pageTableHeight || options.pageTableSize || options.pageTableWidth || 2048
        );

        this.pageTableWidth = pageGrid.width;

        this.pageTableHeight = pageGrid.height;

        this.pageTableSize = this.pageTableWidth;

        // Physical texture cache (all textures share this)
        this.physicalCache = null;
        this.pageTable = null; // Maps virtual pages to physical cache

        // LRU cache management
        this.lruList = [];
        this.pageMap = new Map();

        // Feedback buffer (GPU tells us what to load)
        this.feedbackBuffer = null;
        this.feedbackReadback = null;
        this.feedbackReadbacks = [];
        this._feedbackTicket = 0;
        this._feedbackLoadQueue = [];
        this._activeLoads = 0;
        this.feedbackLayout = virtualTextureFeedbackBufferLayout(this.pageTableWidth, this.pageTableHeight);
        this._feedbackClearData = null;

        const physicalPageCount = virtualTexturePhysicalPageGrid(this.cacheSize, this.pageSize).pageCount;
        this.pageRuntime = new SparsePageRuntime({
            capacity: physicalPageCount,
            byteBudget: physicalPageCount * this.pageSize * this.pageSize * 4,
            requireFallback: true,
            logger: options.logger,
        });

        // Page data sources
        this.baseUrl = options.baseUrl || '/textures/pages/';
        this.useIndexedDB = options.useIndexedDB !== false;
        this.db = null;
        this.dbName = 'VirtualTextureCache';
        this.pendingLoads = new Set(); // Prevent duplicate loads
        this._loadPromises = new Map();

        this.stats = {
            cacheHits: 0,
            cacheMisses: 0,
            pagesLoaded: 0,
            pagesEvicted: 0,
            networkLoads: 0,
            diskLoads: 0,
            feedbackRequests: 0,
            feedbackDropped: 0,
            feedbackResidentSkipped: 0,
            feedbackRingBusy: 0,
            backgroundLoads: 0,
            backgroundLoadErrors: 0,
            fallbackSamplesAvailable: false,
        };
    }

    async init() {
        await this._initIndexedDB();
        await this._createPhysicalCache();
        await this._createPageTable();
        await this._createFeedbackBuffer();
        this._initializeFallbackPage();
        console.log('[VirtualTexturing] Initialized - Streaming texture system ready');
    }

    async _initIndexedDB() {
        if (!this.useIndexedDB || typeof indexedDB === 'undefined') {
            this.useIndexedDB = false;
            return;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => {
                console.warn('[VirtualTexturing] IndexedDB not available, using network only');
                this.useIndexedDB = false;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('pages')) {
                    db.createObjectStore('pages', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('[VirtualTexturing] IndexedDB cache initialized');
                resolve();
            };
        });
    }

    async _createPhysicalCache() {
        // Physical cache is a large atlas that stores all currently resident pages
        const atlasSize = this.cacheSize;
        this.physicalCache = this.vgpu.texture.create({
            width: atlasSize, height: atlasSize,
            format: this.cacheFormat, mipLevelCount: 1,
            usage: 'texture|copy-dst|render', label: 'PhysicalTextureCache'
        }).texture;
    }

    async _createPageTable() {
        // Page table maps virtual UV coordinates to physical cache coordinates
        const pageGrid = virtualTexturePageGrid(this.pageTableWidth, this.pageTableHeight);
        this.pageTable = this.vgpu.texture.create({
            width: pageGrid.width, height: pageGrid.height,
            format: 'rgba16uint', usage: 'texture|storage|copy-dst',
            label: 'PageTable'
        }).texture;
    }

    async _createFeedbackBuffer() {
        this.feedbackLayout = virtualTextureFeedbackBufferLayout(this.pageTableWidth, this.pageTableHeight);
        this.feedbackBuffer = this.vgpu.buffer.create({
            size: this.feedbackLayout.byteLength, usage: 'storage|copy-src|copy-dst', label: 'FeedbackBuffer'
        }).buffer;

        // A ring keeps mapping asynchronous and prevents a feedback readback
        // from stalling the frame that records rendering work.
        this.feedbackReadbacks = Array.from({ length: this.feedbackRingSize }, (_unused, index) => ({
            index,
            state: 'idle',
            ticket: 0,
            promise: null,
            compacted: null,
            error: null,
            buffer: this.vgpu.buffer.create({
                size: this.feedbackLayout.byteLength,
                usage: 'map-read|copy-dst',
                label: `FeedbackReadback[${index}]`,
            }).buffer,
        }));
        this.feedbackReadback = this.feedbackReadbacks[0]?.buffer ?? null;
    }

    _initializeFallbackPage() {
        const key = '__virtual-texture-fallback__';
        const data = this._generateFallbackPage();
        this.pageRuntime.beginRevision(this.pageRuntime.revision + 1);
        this.pageRuntime.stagePage({
            key,
            level: this.maxMipLevels - 1,
            bytes: data.byteLength,
            sourceRevision: 0,
            certificateRevision: 0,
            fallbackKey: null,
            pinned: true,
            payload: data,
            metadata: { role: 'global-coarse-fallback' },
        });
        const publication = this.pageRuntime.commitRevision();
        const fallback = publication.pages.find(page => page.key === key);
        if (!fallback) throw new Error('VirtualTexturing failed to publish its pinned fallback page');
        if (fallback.slot !== 0) {
            throw new Error(`VirtualTexturing pinned fallback must occupy physical slot zero, received ${fallback.slot}`);
        }
        const origin = virtualTexturePhysicalPageOrigin(fallback.slot, this.cacheSize, this.pageSize);
        this.device.queue.writeTexture(
            { texture: this.physicalCache, origin: [origin.x, origin.y, 0] },
            data,
            { bytesPerRow: this.pageSize * 4 },
            [this.pageSize, this.pageSize, 1],
        );
        this.fallbackPage = Object.freeze({ key, slot: fallback.slot, origin });
        this.stats.fallbackSamplesAvailable = true;
    }

    /**
     * Sample virtual texture in shader
     * Returns shader code for virtual texture sampling
     */
    getShaderSamplingCode() {
        const pageGrid = virtualTexturePageGrid(this.pageTableWidth, this.pageTableHeight);

        const cacheGrid = virtualTexturePhysicalPageGrid(this.cacheSize, this.pageSize);

        const pageTableExtent = `vec2<f32>(${pageGrid.width}.0, ${pageGrid.height}.0)`;

        const cacheExtent = `vec2<f32>(${cacheGrid.cacheWidth}.0, ${cacheGrid.cacheHeight}.0)`;

        return `
// Virtual texture sampling
@group(1) @binding(0) var physicalCache: texture_2d<f32>;
@group(1) @binding(1) var pageTable: texture_2d<u32>;
@group(1) @binding(2) var linearSampler: sampler;
@group(1) @binding(3) var<storage, read_write> feedback: array<atomic<u32>>;

fn sampleVirtualTexture(virtualUV: vec2<f32>, mipLevel: f32) -> vec4<f32> {
    // Calculate page coordinates
    let rawPageCoord = vec2<u32>(virtualUV * ${pageTableExtent});
    let pageCoord = min(rawPageCoord, vec2<u32>(${pageGrid.width - 1}u, ${pageGrid.height - 1}u));

    // Look up page table
    let pageEntry = textureLoad(pageTable, pageCoord, 0);
    let physicalX = pageEntry.r;
    let physicalY = pageEntry.g;
    let resident = pageEntry.b;

    // Check if page is resident
    if (resident == 0u) {
        // Request page via feedback buffer
        let pageId = pageCoord.y * ${pageGrid.width}u + pageCoord.x;
        atomicStore(&feedback[pageId], 1u);

        // Slot zero is a pinned coarse fallback. Missing fine pages remain
        // textured while feedback requests a better page.
        let fallbackUV = fract(virtualUV * ${pageTableExtent}) *
            (${cacheGrid.pageSize}.0 / ${cacheExtent});
        return textureSampleLevel(physicalCache, linearSampler, fallbackUV, 0.0);
    }

    // Calculate physical UV
    let pageSize = ${cacheGrid.pageSize}.0;
    let physicalUV = (vec2<f32>(physicalX, physicalY) * pageSize +
                     fract(virtualUV * ${pageTableExtent}) * pageSize) / ${cacheExtent};

    // Sample from physical cache
    return textureSampleLevel(physicalCache, linearSampler, physicalUV, 0.0);
}
        `;
    }

    /**
     * Record feedback readback and clearing into the host-owned encoder.
     * No queue submission or mapping happens here.
     */
    encodeFeedbackReadback(encoder) {
        if (!encoder || typeof encoder.copyBufferToBuffer !== 'function') {
            throw new TypeError('VirtualTexturing encodeFeedbackReadback requires a GPUCommandEncoder');
        }
        const slot = this.feedbackReadbacks.find(candidate => candidate.state === 'idle');
        if (!slot) {
            this.stats.feedbackRingBusy++;
            return null;
        }
        const ticket = ++this._feedbackTicket;
        encoder.copyBufferToBuffer(
            this.feedbackBuffer, 0,
            slot.buffer, 0,
            this.feedbackLayout.byteLength
        );
        if (typeof encoder.clearBuffer !== 'function') {
            slot.state = 'idle';
            throw new Error('VirtualTexturing requires GPUCommandEncoder.clearBuffer for external-encoder feedback');
        }
        encoder.clearBuffer(this.feedbackBuffer, 0, this.feedbackLayout.byteLength);
        slot.state = 'encoded';
        slot.ticket = ticket;
        slot.compacted = null;
        slot.error = null;
        return Object.freeze({ ticket, slot: slot.index });
    }

    /** Notify the ring after the host has submitted the command buffer. */
    notifyFeedbackSubmitted(ticketValue) {
        const ticket = Number(ticketValue?.ticket ?? ticketValue);
        const slot = this.feedbackReadbacks.find(candidate => candidate.ticket === ticket && candidate.state === 'encoded');
        if (!slot) throw new RangeError(`VirtualTexturing feedback ticket ${ticket} is not awaiting submission`);
        slot.state = 'mapping';
        slot.promise = slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
            const mapped = new Uint32Array(slot.buffer.getMappedRange());
            const feedbackData = new Uint32Array(mapped);
            slot.buffer.unmap();
            slot.compacted = compactVirtualTextureFeedback(feedbackData, {
                pageTableWidth: this.pageTableWidth,
                pageTableHeight: this.pageTableHeight,
                maxRequests: this.maxFeedbackRequests,
            });
            slot.state = 'ready';
            return slot.compacted;
        }).catch(error => {
            slot.error = error;
            slot.state = 'error';
            // Keep asynchronous map failures observable through pollFeedback()
            // without creating an unhandled rejection when a host deliberately
            // treats feedback as fire-and-forget optional work.
            return null;
        });
        return slot.promise;
    }

    /** Consume completed feedback without awaiting a GPU map or page fetch. */
    pollFeedback() {
        const completed = [];
        for (const slot of this.feedbackReadbacks) {
            if (slot.state === 'error') {
                const error = slot.error;
                slot.state = 'idle';
                slot.ticket = 0;
                slot.promise = null;
                slot.error = null;
                throw error;
            }
            if (slot.state !== 'ready') continue;
            const compacted = slot.compacted;
            this.stats.feedbackRequests += compacted.totalRequests;
            this.stats.feedbackDropped += compacted.droppedRequests;
            this.stats.feedbackResidentSkipped += compacted.residentSkipped;
            for (const pageId of compacted.pageIds) this._schedulePageLoad(pageId, 0);
            completed.push(Object.freeze({ ticket: slot.ticket, ...compacted }));
            slot.state = 'idle';
            slot.ticket = 0;
            slot.promise = null;
            slot.compacted = null;
        }
        return Object.freeze(completed);
    }

    _schedulePageLoad(pageId, mipLevel) {
        const key = `${mipLevel}:${pageId}`;
        if (this.pageMap.has(key) || this.pendingLoads.has(key)) return;
        this.pendingLoads.add(key);
        this._feedbackLoadQueue.push({ pageId, mipLevel, key });
        this._pumpPageLoads();
    }

    _pumpPageLoads() {
        while (this._activeLoads < this.maxConcurrentLoads && this._feedbackLoadQueue.length > 0) {
            const request = this._feedbackLoadQueue.shift();
            this._activeLoads++;
            this.stats.backgroundLoads++;
            this._loadPage(request.pageId, request.mipLevel).catch(error => {
                this.stats.backgroundLoadErrors++;
                console.warn(`[VirtualTexturing] Background page ${request.key} failed:`, error);
            }).finally(() => {
                this.pendingLoads.delete(request.key);
                this._activeLoads--;
                this._pumpPageLoads();
            });
        }
    }

    /** Compatibility wrapper for callers that still own a self-contained job. */
    async processFeedback() {
        const encoder = this.device.createCommandEncoder({ label: 'VirtualTexturing.Feedback.Compatibility' });
        const ticket = this.encodeFeedbackReadback(encoder);
        if (!ticket) return [];
        this.device.queue.submit([encoder.finish()]);
        const compacted = await this.notifyFeedbackSubmitted(ticket);
        const completed = this.pollFeedback();
        await Promise.all(compacted.pageIds.map(pageId => this._loadPage(pageId, 0)));
        return completed;
    }

    _loadPage(pageId, mipLevel = 0) {
        const key = `${mipLevel}:${pageId}`;
        const existing = this._loadPromises.get(key);
        if (existing) return existing;
        const promise = this._loadPageUnshared(pageId, mipLevel).finally(() => this._loadPromises.delete(key));
        this._loadPromises.set(key, promise);
        return promise;
    }

    async _loadPageUnshared(pageId, mipLevel = 0) {
        const key = `${mipLevel}:${pageId}`;
        // Check if already in cache
        if (this.pageMap.has(key)) {
            this._touchPage(key);
            this.stats.cacheHits++;
            return;
        }

        this.stats.cacheMisses++;

        // Load page from disk/network (async)
        const pageData = this._normalizePageData(await this._fetchPageData(pageId, mipLevel), pageId);
        const before = this.pageRuntime.snapshot();
        let publication;
        try {
            this.pageRuntime.beginRevision(this.pageRuntime.revision + 1);
            this.pageRuntime.stagePage({
                key,
                level: mipLevel,
                bytes: pageData.byteLength,
                sourceRevision: this.pageRuntime.revision + 1,
                certificateRevision: 0,
                fallbackKey: this.fallbackPage.key,
                pinned: false,
                payload: pageData,
                metadata: { pageId, mipLevel },
            });
            publication = this.pageRuntime.commitRevision();
        } catch (error) {
            this.pageRuntime.rollbackRevision();
            throw error;
        }
        const published = publication.pages.find(page => page.key === key);
        this._synchronizePublishedPages(before, publication);
        if (!published) return;
        const physicalLocation = virtualTexturePhysicalPageOrigin(published.slot, this.cacheSize, this.pageSize);

        // Upload to physical cache
        this.device.queue.writeTexture(
            {
                texture: this.physicalCache,
                origin: [physicalLocation.x, physicalLocation.y, 0],
            },
            pageData,
            {
                bytesPerRow: this.pageSize * 4,
            },
            [this.pageSize, this.pageSize, 1]
        );

        // Update page table
        this._updatePageTable(pageId, physicalLocation);

        // Add to LRU
        this.lruList.push(key);
        this.pageMap.set(key, Object.freeze({ ...physicalLocation, pageId, mipLevel, slot: published.slot }));
        this.stats.pagesLoaded++;
    }

    _normalizePageData(value, pageId) {
        const data = value instanceof Uint8Array
            ? value
            : ArrayBuffer.isView(value)
                ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                : value instanceof ArrayBuffer
                    ? new Uint8Array(value)
                    : null;
        const expected = this.pageSize * this.pageSize * 4;
        if (!data || data.byteLength !== expected) {
            console.warn(`[VirtualTexturing] Page ${pageId} contained ${data?.byteLength ?? 0} bytes; expected ${expected}. Using a diagnostic page.`);
            return this._generatePlaceholderPage(pageId);
        }
        return data;
    }

    _synchronizePublishedPages(before, after) {
        const afterKeys = new Set(after.pages.map(page => page.key));
        for (const page of before.pages) {
            if (page.key === this.fallbackPage.key || afterKeys.has(page.key)) continue;
            const location = this.pageMap.get(page.key);
            if (location) this._clearPageTable(location.pageId);
            this.pageMap.delete(page.key);
            const index = this.lruList.indexOf(page.key);
            if (index >= 0) this.lruList.splice(index, 1);
            this.stats.pagesEvicted++;
        }
    }

    _touchPage(key) {
        this.pageRuntime.resolve(key, [this.fallbackPage.key]);
        // Move to end of LRU
        const idx = this.lruList.indexOf(key);
        if (idx >= 0) {
            this.lruList.splice(idx, 1);
            this.lruList.push(key);
        }
    }

    _getMaxCachePages() {
        return virtualTexturePhysicalPageGrid(this.cacheSize, this.pageSize).pageCount;
    }

    async _fetchPageData(pageId, mipLevel = 0) {
        // Try IndexedDB first (disk cache)
        if (this.useIndexedDB && this.db) {
            const cachedData = await this._getFromIndexedDB(`${mipLevel}:${pageId}`);
            if (cachedData) {
                this.stats.diskLoads++;
                return cachedData;
            }
        }

        // Fetch from network
        try {
            const { x: pageX, y: pageY } = virtualTexturePageCoord(pageId, this.pageTableWidth, this.pageTableHeight);
            const url = `${this.baseUrl}${mipLevel}/${pageY}/${pageX}.bin`;

            const response = await fetch(url);
            if (!response.ok) {
                // Page doesn't exist on server, return placeholder
                return this._generatePlaceholderPage(pageId);
            }

            const data = new Uint8Array(await response.arrayBuffer());
            this.stats.networkLoads++;

            // Store in IndexedDB for future use
            if (this.useIndexedDB && this.db) {
                this._storeInIndexedDB(`${mipLevel}:${pageId}`, data);
            }

            return data;
        } catch (error) {
            console.warn(`[VirtualTexturing] Failed to fetch page ${pageId}:`, error);
            return this._generatePlaceholderPage(pageId);
        }
    }

    _generatePlaceholderPage(pageId) {
        // Generate a checkerboard pattern for missing pages (debug visualization)
        const size = this.pageSize;
        const data = new Uint8Array(size * size * 4);
        const tileSize = 16;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const isWhite = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0;

                // Magenta/dark checkerboard for missing pages
                data[idx + 0] = isWhite ? 255 : 128;  // R
                data[idx + 1] = isWhite ? 0 : 0;      // G
                data[idx + 2] = isWhite ? 255 : 128;  // B
                data[idx + 3] = 255;                   // A
            }
        }

        return data;
    }

    _generateFallbackPage() {
        const size = this.pageSize;
        const data = new Uint8Array(size * size * 4);
        const tileSize = Math.max(8, Math.floor(size / 8));
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;
                const high = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) & 1) === 0;
                const value = high ? 118 : 102;
                data[index] = value;
                data[index + 1] = value;
                data[index + 2] = value;
                data[index + 3] = 255;
            }
        }
        return data;
    }

    async _getFromIndexedDB(pageId) {
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction(['pages'], 'readonly');
                const store = transaction.objectStore('pages');
                const request = store.get(pageId);

                request.onsuccess = () => {
                    resolve(request.result?.data || null);
                };
                request.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    _storeInIndexedDB(pageId, data) {
        try {
            const transaction = this.db.transaction(['pages'], 'readwrite');
            const store = transaction.objectStore('pages');
            store.put({ id: pageId, data: data, timestamp: Date.now() });
        } catch (e) {
            console.warn('[VirtualTexturing] Failed to cache page in IndexedDB:', e);
        }
    }

    /**
     * Clear IndexedDB cache
     */
    async clearDiskCache() {
        if (!this.db) return;

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['pages'], 'readwrite');
            const store = transaction.objectStore('pages');
            const request = store.clear();
            request.onsuccess = () => {
                console.log('[VirtualTexturing] Disk cache cleared');
                resolve();
            };
            request.onerror = () => resolve();
        });
    }

    /**
     * Prefetch pages for a region (call during loading screens)
     */
    async prefetchRegion(startX, startY, width, height, mipLevel = 0) {
        const promises = [];
        for (let y = startY; y < startY + height; y++) {
            for (let x = startX; x < startX + width; x++) {
                const pageId = virtualTexturePageId(x, y, this.pageTableWidth, this.pageTableHeight);
                const key = `${mipLevel}:${pageId}`;
                if (!this.pageMap.has(key) && !this.pendingLoads.has(key)) {
                    this.pendingLoads.add(key);
                    promises.push(this._loadPage(pageId, mipLevel).finally(() => {
                        this.pendingLoads.delete(key);
                    }));
                }
            }
        }
        await Promise.all(promises);
    }

    _updatePageTable(pageId, physicalLocation) {
        // Update page table entry
        const entry = virtualTexturePageTableEntry(pageId, physicalLocation, {
            pageTableWidth: this.pageTableWidth,
            pageTableHeight: this.pageTableHeight,
            pageSize: this.pageSize,
        });

        const pageTableEntry = new Uint16Array(entry.values);

        this.device.queue.writeTexture(
            {
                texture: this.pageTable,
                origin: [entry.pageX, entry.pageY, 0],
            },
            pageTableEntry.buffer,
            {
                bytesPerRow: 8,
            },
            [1, 1, 1]
        );
    }

    _clearPageTable(pageId) {
        const { x, y } = virtualTexturePageCoord(pageId, this.pageTableWidth, this.pageTableHeight);
        const empty = new Uint16Array(4);
        this.device.queue.writeTexture(
            { texture: this.pageTable, origin: [x, y, 0] },
            empty,
            { bytesPerRow: 8 },
            [1, 1, 1],
        );
    }

    getStats() {
        return {
            ...this.stats,
            cacheUtilization: this.pageMap.size / this._getMaxCachePages(),
            residentPages: this.pageMap.size,
            pendingLoads: this.pendingLoads.size,
            queuedLoads: this._feedbackLoadQueue.length,
            activeLoads: this._activeLoads,
            feedbackRing: Object.freeze(this.feedbackReadbacks.map(slot => slot.state)),
            sparsePages: this.pageRuntime.getStats(),
        };
    }

    destroy() {
        if (this.physicalCache) this.physicalCache.destroy();
        if (this.pageTable) this.pageTable.destroy();
        if (this.feedbackBuffer) this.feedbackBuffer.destroy();
        for (const slot of this.feedbackReadbacks) slot.buffer.destroy();
        this.feedbackReadbacks.length = 0;
        this.feedbackReadback = null;
        this.db?.close?.();
        this.db = null;
    }
}
