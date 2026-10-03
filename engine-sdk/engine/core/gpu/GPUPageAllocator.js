// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPUPageAllocator.js - Virtual Heap on GPU Memory
 * 
 * A paged memory allocator for WebGPU that:
 * - Uses fixed-size buffer "pages" (never resizes)
 * - Append-only writes within pages
 * - Automatic rollover to new pages when full
 * - Shader indirection via page index + offset
 * - Graceful handling of allocation failures
 * 
 * Mental model: A virtual heap on top of unknown hardware.
 * Scales across all GPUs and browsers within WebGPU rules.
 */

// Default page size: 16MB (safely under most per-binding limits)
const DEFAULT_PAGE_SIZE = 16 * 1024 * 1024;

// Maximum pages to keep bound at once
const MAX_BOUND_PAGES = 8;

// Staging buffer ring size (2-3 is optimal per Toji.dev best practices)
const STAGING_RING_SIZE = 3;

// Alignment requirements
const UNIFORM_ALIGNMENT = 256;  // WebGPU uniform buffer offset alignment
const STORAGE_ALIGNMENT = 4;    // Storage buffer minimum alignment

/**
 * Represents a single GPU memory page
 */
class GPUPage {
    constructor(device, size, index, usage) {
        this.device = device;
        this.size = size;
        this.index = index;
        this.usage = usage;
        this.buffer = null;
        this.offset = 0;  // Current write offset (append-only)
        this.full = false;
        this.frameLastUsed = 0;
        
        this._createBuffer();
    }
    
    _createBuffer() {
        try {
            this.buffer = this.device.createBuffer({
                label: `GPUPage_${this.index}`,
                size: this.size,
                usage: this.usage,
            });
        } catch (e) {
            console.error(`[GPUPageAllocator] Failed to create page ${this.index}:`, e);
            this.buffer = null;
        }
    }
    
    /**
     * Get remaining space in this page
     */
    get remaining() {
        return this.size - this.offset;
    }
    
    /**
     * Check if page can fit data of given size
     */
    canFit(dataSize) {
        return !this.full && this.buffer && (this.offset + dataSize <= this.size);
    }
    
    /**
     * Write data to this page (append-only)
     * @returns {{ pageIndex: number, offset: number, size: number } | null}
     */
    write(device, data) {
        if (!this.canFit(data.byteLength)) {
            return null;
        }
        
        const writeOffset = this.offset;
        device.queue.writeBuffer(this.buffer, writeOffset, data);
        this.offset += data.byteLength;
        
        // Align to 256 bytes for WebGPU uniform buffer offset alignment
        this.offset = Math.ceil(this.offset / 256) * 256;
        
        // Mark full if less than 1KB remaining (avoid tiny allocations)
        if (this.remaining < 1024) {
            this.full = true;
        }
        
        return {
            pageIndex: this.index,
            offset: writeOffset,
            size: data.byteLength,
        };
    }
    
    /**
     * Mark page as used this frame
     */
    touch(frameNumber) {
        this.frameLastUsed = frameNumber;
    }
    
    /**
     * Reset page for reuse (clears offset, not data)
     */
    reset() {
        this.offset = 0;
        this.full = false;
    }
    
    /**
     * Destroy the underlying buffer
     */
    destroy() {
        if (this.buffer) {
            this.buffer.destroy();
            this.buffer = null;
        }
    }
}

/**
 * GPUPageAllocator - Virtual heap for GPU memory
 */
export class GPUPageAllocator {
    constructor(options = {}) {
        this.device = null;
        this.initialized = false;
        
        // Configuration
        this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
        this.maxPages = options.maxPages || 64;
        this.maxBoundPages = options.maxBoundPages || MAX_BOUND_PAGES;
        this.usage = options.usage || (
            GPUBufferUsage.STORAGE | 
            GPUBufferUsage.COPY_DST
        );
        
        // Page tracking
        this.pages = [];           // All pages
        this.activePageIndex = -1; // Current page being written to
        this.fullPages = [];       // Indices of full pages
        this.freePages = [];       // Indices of pages available for reuse
        
        // Frame tracking
        this.currentFrame = 0;
        this.pagesUsedThisFrame = new Set();
        
        // Staging buffer ring (for zero-copy uploads via mapAsync)
        this.stagingRing = [];
        this.stagingRingSize = options.stagingRingSize || STAGING_RING_SIZE;
        this.pendingStagingBuffers = []; // Buffers waiting for mapAsync to complete
        
        // Alignment
        this.alignment = options.alignment || STORAGE_ALIGNMENT;
        
        // Memory pressure detection
        this.lastAllocationTime = 0;
        this.allocationTimeThreshold = 100; // ms - if allocation takes longer, we're under pressure
        
        // Detected VRAM limits (set by probing)
        this.detectedVRAM = 0;
        this.memoryLimit = this.pageSize * this.maxPages; // Default until probed
        
        // Stats
        this.stats = {
            totalAllocated: 0,
            totalWritten: 0,
            pageCount: 0,
            allocationFailures: 0,
            rollovers: 0,
            stagingHits: 0,
            stagingMisses: 0,
            memoryPressureEvents: 0,
        };
    }
    
    /**
     * Initialize the allocator
     * @param {GPUDevice} device
     * @param {Object} options - { probeMemory: true/false, reservePercent: 0.8 }
     * Destructive memory probing is opt-in and runs only for probeMemory === true.
     */
    async init(device, options = {}) {
        this.device = device;
        
        // Probe GPU memory to detect limits only when explicitly requested.
        if (options.probeMemory === true) {
            await this._probeGPUMemory(options.reservePercent || 0.75);
        }
        
        // Create initial page
        this._allocateNewPage();
        
        // Pre-create staging buffers (mappedAtCreation for immediate use)
        this._initStagingRing();
        
        this.initialized = true;
        console.log(`[GPUPageAllocator] Initialized: ${(this.pageSize / 1024 / 1024).toFixed(1)}MB pages, max ${this.maxPages} pages (${(this.detectedVRAM / 1024 / 1024).toFixed(0)}MB VRAM detected), ${this.stagingRingSize} staging buffers`);
    }
    
    /**
     * Probe GPU memory by allocating until failure
     * Sets maxPages based on detected available memory
     * @param {number} reservePercent - How much of detected VRAM to use (0.0-1.0)
     */
    async _probeGPUMemory(reservePercent = 0.75) {
        const probeBuffers = [];
        const probeSize = this.pageSize; // Use page size for probing
        let totalProbed = 0;
        
        console.log('[GPUPageAllocator] Probing GPU memory...');
        
        try {
            // Try to allocate buffers until we fail
            // Limit probe to reasonable max (8GB) to avoid infinite loop
            const maxProbeBytes = 8 * 1024 * 1024 * 1024;
            
            while (totalProbed < maxProbeBytes) {
                try {
                    const buffer = this.device.createBuffer({
                        label: `MemoryProbe_${probeBuffers.length}`,
                        size: probeSize,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                    });
                    
                    probeBuffers.push(buffer);
                    totalProbed += probeSize;
                    
                    // Yield to allow GPU to process
                    if (probeBuffers.length % 10 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                } catch (e) {
                    // Allocation failed - we've found the limit
                    console.log(`[GPUPageAllocator] Probe allocation failed at ${(totalProbed / 1024 / 1024).toFixed(0)}MB`);
                    break;
                }
            }
        } finally {
            // Clean up probe buffers
            for (const buffer of probeBuffers) {
                buffer.destroy();
            }
        }
        
        // Store detected VRAM
        this.detectedVRAM = totalProbed;
        
        // Calculate soft limit (preferred) and hard limit (absolute max)
        const softLimit = Math.floor(totalProbed * reservePercent);
        const hardLimit = Math.floor(totalProbed * 0.95); // Never exceed 95% of detected VRAM
        
        // Update maxPages based on HARD limit (allow going over soft limit)
        const hardMaxPages = Math.floor(hardLimit / this.pageSize);
        const softMaxPages = Math.floor(softLimit / this.pageSize);
        this.maxPages = Math.max(4, hardMaxPages); // At least 4 pages, up to hard limit
        
        // Store limits
        this.softLimit = softLimit;
        this.hardLimit = hardLimit;
        this.memoryLimit = softLimit; // Report soft limit as the "limit"
        this.softMaxPages = softMaxPages;
        
        console.log(`[GPUPageAllocator] Detected ${(totalProbed / 1024 / 1024).toFixed(0)}MB VRAM`);
        console.log(`[GPUPageAllocator] Soft limit: ${(softLimit / 1024 / 1024).toFixed(0)}MB (${(reservePercent * 100).toFixed(0)}%), ${softMaxPages} pages`);
        console.log(`[GPUPageAllocator] Hard limit: ${(hardLimit / 1024 / 1024).toFixed(0)}MB (95%), ${hardMaxPages} pages`);
        
        this.stats.detectedVRAM = totalProbed;
        this.stats.memoryLimit = softLimit;
    }
    
    /**
     * Initialize staging buffer ring
     */
    _initStagingRing() {
        // Create initial staging buffers with mappedAtCreation
        // These are ready for immediate use
        for (let i = 0; i < this.stagingRingSize; i++) {
            const staging = this._createStagingBuffer();
            if (staging) {
                this.stagingRing.push(staging);
            }
        }
    }
    
    /**
     * Create a staging buffer (MAP_WRITE + COPY_SRC)
     */
    _createStagingBuffer() {
        try {
            const buffer = this.device.createBuffer({
                label: `StagingBuffer_${this.stagingRing.length}`,
                size: this.pageSize,
                usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
                mappedAtCreation: true,
            });
            return {
                buffer,
                mapped: true,
                mappedRange: buffer.getMappedRange(),
                offset: 0,
            };
        } catch (e) {
            console.warn('[GPUPageAllocator] Failed to create staging buffer:', e);
            return null;
        }
    }
    
    /**
     * Get a staging buffer for zero-copy writes
     * @param {number} size - Required size in bytes
     * @returns {{ buffer: GPUBuffer, mappedRange: ArrayBuffer, offset: number } | null}
     */
    acquireStaging(size) {
        // Find a mapped staging buffer with enough space
        for (let i = 0; i < this.stagingRing.length; i++) {
            const staging = this.stagingRing[i];
            if (staging.mapped && (staging.offset + size <= this.pageSize)) {
                this.stats.stagingHits++;
                const result = {
                    buffer: staging.buffer,
                    mappedRange: staging.mappedRange,
                    offset: staging.offset,
                    staging, // Reference for later
                };
                // Advance offset (aligned)
                staging.offset += Math.ceil(size / this.alignment) * this.alignment;
                return result;
            }
        }
        
        // No staging buffer available - fall back to writeBuffer
        this.stats.stagingMisses++;
        return null;
    }
    
    /**
     * Commit staging buffer to GPU and re-map for next use
     * @param {Object} staging - Staging buffer info
     * @param {GPUBuffer} targetBuffer - Target GPU buffer
     * @param {number} targetOffset - Offset in target buffer
     * @param {number} size - Size to copy
     */
    commitStaging(staging, targetBuffer, targetOffset, size) {
        if (!staging.buffer) return;
        
        // Unmap before copy
        staging.buffer.unmap();
        staging.mapped = false;
        
        // Copy to target
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(
            staging.buffer, 0,
            targetBuffer, targetOffset,
            size
        );
        this.device.queue.submit([encoder.finish()]);
        
        // Re-map immediately (async) - when complete, it returns to the ring
        staging.buffer.mapAsync(GPUMapMode.WRITE).then(() => {
            staging.mappedRange = staging.buffer.getMappedRange();
            staging.mapped = true;
            staging.offset = 0;
        }).catch(() => {
            // Failed to re-map - remove from ring
            const idx = this.stagingRing.indexOf(staging);
            if (idx >= 0) this.stagingRing.splice(idx, 1);
        });
    }
    
    /**
     * Begin a new frame - reset frame tracking
     */
    beginFrame() {
        this.currentFrame++;
        this.pagesUsedThisFrame.clear();
        
        // Check for pending staging buffers that have completed mapping
        this._processPendingStagingBuffers();
    }
    
    /**
     * Process pending staging buffers
     */
    _processPendingStagingBuffers() {
        // Move completed pending buffers back to the ring
        for (let i = this.pendingStagingBuffers.length - 1; i >= 0; i--) {
            const staging = this.pendingStagingBuffers[i];
            if (staging.mapped) {
                this.pendingStagingBuffers.splice(i, 1);
                this.stagingRing.push(staging);
            }
        }
    }
    
    /**
     * Allocate a new page
     * @returns {GPUPage | null}
     */
    _allocateNewPage() {
        // Check if we can reuse a free page
        if (this.freePages.length > 0) {
            const freeIndex = this.freePages.pop();
            const page = this.pages[freeIndex];
            page.reset();
            this.activePageIndex = freeIndex;
            return page;
        }
        
        // Check hard limit (95% of detected VRAM) - absolute maximum
        if (this.pages.length >= this.maxPages) {
            console.error(`[GPUPageAllocator] HARD LIMIT reached (${this.maxPages} pages, 95% VRAM) - cannot allocate more`);
            this.stats.allocationFailures++;
            return null;
        }
        
        // Check soft limit and warn if exceeded
        const currentMemory = this.pages.length * this.pageSize;
        const wouldUse = currentMemory + this.pageSize;
        
        if (this.softLimit && wouldUse > this.softLimit) {
            const percentUsed = ((wouldUse / this.detectedVRAM) * 100).toFixed(0);
            const pagesOverSoft = this.pages.length - (this.softMaxPages || 0) + 1;
            
            if (!this._softLimitWarned) {
                console.warn(`[GPUPageAllocator] Exceeded soft limit (${(this.softLimit / 1024 / 1024).toFixed(0)}MB), now at ${percentUsed}% VRAM`);
                this._softLimitWarned = true;
            }
            
            this.stats.memoryPressureEvents++;
            
            // Log every 10 pages over soft limit
            if (pagesOverSoft % 10 === 0) {
                console.warn(`[GPUPageAllocator] ${pagesOverSoft} pages over soft limit, ${percentUsed}% VRAM used`);
            }
        }
        
        // Create new page
        const index = this.pages.length;
        const page = new GPUPage(this.device, this.pageSize, index, this.usage);
        
        if (!page.buffer) {
            this.stats.allocationFailures++;
            return null;
        }
        
        this.pages.push(page);
        this.activePageIndex = index;
        this.stats.pageCount++;
        this.stats.totalAllocated += this.pageSize;
        
        return page;
    }
    
    /**
     * Get the active page, or allocate a new one
     */
    _getActivePage() {
        if (this.activePageIndex >= 0) {
            const page = this.pages[this.activePageIndex];
            if (page && !page.full) {
                return page;
            }
        }
        return this._allocateNewPage();
    }
    
    /**
     * Write data to the allocator (uses writeBuffer - recommended by WebGPU spec)
     * @param {ArrayBuffer | TypedArray} data - Data to write
     * @returns {{ pageIndex: number, offset: number, size: number, buffer: GPUBuffer } | null}
     */
    write(data) {
        if (!this.initialized || !this.device) {
            console.warn('[GPUPageAllocator] Not initialized');
            return null;
        }
        
        const dataSize = data.byteLength;
        
        // Check if data fits in a single page
        if (dataSize > this.pageSize) {
            console.error(`[GPUPageAllocator] Data too large (${dataSize} > ${this.pageSize})`);
            return null;
        }
        
        // Try to write to active page
        let page = this._getActivePage();
        
        if (!page) {
            // Back pressure: allocation failed
            this.stats.allocationFailures++;
            return null;
        }
        
        // Check if active page can fit the data
        if (!page.canFit(dataSize)) {
            // Rollover to new page
            this.fullPages.push(this.activePageIndex);
            page = this._allocateNewPage();
            this.stats.rollovers++;
            
            if (!page) {
                return null;
            }
        }
        
        // Write data
        const allocation = page.write(this.device, data);
        
        if (allocation) {
            page.touch(this.currentFrame);
            this.pagesUsedThisFrame.add(allocation.pageIndex);
            this.stats.totalWritten += dataSize;
            
            // Return allocation info with buffer reference
            return {
                ...allocation,
                buffer: page.buffer,
            };
        }
        
        return null;
    }
    
    /**
     * Zero-copy write using staging buffer ring
     * Use when data is being generated (not already in ArrayBuffer)
     * @param {number} size - Size to allocate
     * @param {Function} fillCallback - (arrayBuffer, offset) => void - fills the mapped memory
     * @returns {{ pageIndex: number, offset: number, size: number, buffer: GPUBuffer } | null}
     */
    writeZeroCopy(size, fillCallback) {
        if (!this.initialized || !this.device) return null;
        
        // Acquire staging buffer
        const staging = this.acquireStaging(size);
        if (!staging) {
            // Fall back to regular write with temporary buffer
            const tempBuffer = new ArrayBuffer(size);
            fillCallback(tempBuffer, 0);
            return this.write(new Uint8Array(tempBuffer));
        }
        
        // Get target page
        let page = this._getActivePage();
        if (!page || !page.canFit(size)) {
            if (page) this.fullPages.push(this.activePageIndex);
            page = this._allocateNewPage();
            this.stats.rollovers++;
            if (!page) return null;
        }
        
        const targetOffset = page.offset;
        
        // Fill directly into mapped staging memory (zero-copy!)
        const view = new Uint8Array(staging.mappedRange, staging.offset, size);
        fillCallback(view.buffer, staging.offset);
        
        // Advance page offset
        page.offset += Math.ceil(size / this.alignment) * this.alignment;
        if (page.remaining < 1024) page.full = true;
        
        // Commit staging to GPU
        this.commitStaging(staging.staging, page.buffer, targetOffset, size);
        
        page.touch(this.currentFrame);
        this.pagesUsedThisFrame.add(page.index);
        this.stats.totalWritten += size;
        
        return {
            pageIndex: page.index,
            offset: targetOffset,
            size,
            buffer: page.buffer,
        };
    }
    
    /**
     * Get pages used this frame for binding
     * @returns {GPUPage[]}
     */
    getPagesForBinding() {
        const pages = [];
        for (const pageIndex of this.pagesUsedThisFrame) {
            if (this.pages[pageIndex]) {
                pages.push(this.pages[pageIndex]);
            }
        }
        
        // Limit to max bound pages
        if (pages.length > this.maxBoundPages) {
            // Sort by most recently used and take the latest
            pages.sort((a, b) => b.frameLastUsed - a.frameLastUsed);
            return pages.slice(0, this.maxBoundPages);
        }
        
        return pages;
    }
    
    /**
     * Get buffer binding entries for bind group
     * @returns {Array<{ binding: number, resource: { buffer: GPUBuffer } }>}
     */
    getBindGroupEntries(startBinding = 0) {
        const pages = this.getPagesForBinding();
        return pages.map((page, i) => ({
            binding: startBinding + i,
            resource: { buffer: page.buffer },
        }));
    }
    
    /**
     * Release pages not used for N frames
     * @param {number} frameThreshold - Frames of inactivity before release
     */
    releaseUnusedPages(frameThreshold = 300) {
        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            if (!page || i === this.activePageIndex) continue;
            
            const framesUnused = this.currentFrame - page.frameLastUsed;
            if (framesUnused > frameThreshold && page.full) {
                // Mark as free for reuse instead of destroying
                page.reset();
                if (!this.freePages.includes(i)) {
                    this.freePages.push(i);
                }
                
                // Remove from full pages
                const fullIdx = this.fullPages.indexOf(i);
                if (fullIdx >= 0) {
                    this.fullPages.splice(fullIdx, 1);
                }
            }
        }
    }
    
    /**
     * Get allocation result for shader (page index + offset)
     * @returns {{ pageIndex: number, offset: number }}
     */
    static toShaderAddress(allocation) {
        if (!allocation) return { pageIndex: 0, offset: 0 };
        return {
            pageIndex: allocation.pageIndex,
            offset: allocation.offset,
        };
    }
    
    /**
     * Get stats for profiler
     */
    getStats() {
        return {
            ...this.stats,
            activePage: this.activePageIndex,
            fullPages: this.fullPages.length,
            freePages: this.freePages.length,
            pagesUsedThisFrame: this.pagesUsedThisFrame.size,
            memoryUsedMB: (this.stats.totalAllocated / 1024 / 1024).toFixed(1),
            memoryWrittenMB: (this.stats.totalWritten / 1024 / 1024).toFixed(1),
        };
    }
    
    /**
     * Destroy all pages
     */
    destroy() {
        for (const page of this.pages) {
            if (page) page.destroy();
        }
        this.pages = [];
        this.fullPages = [];
        this.freePages = [];
        this.activePageIndex = -1;
        this.initialized = false;
    }
}

/**
 * WGSL shader helper for page indirection
 */
export const GPU_PAGE_WGSL = /* wgsl */ `
// Page address structure
struct PageAddress {
    pageIndex: u32,
    offset: u32,
}

// Read from paged storage (example for f32 array)
fn readPagedF32(pages: array<ptr<storage, array<f32>>>, addr: PageAddress, index: u32) -> f32 {
    let page = pages[addr.pageIndex];
    let byteOffset = addr.offset + index * 4u;
    let wordIndex = byteOffset / 4u;
    return (*page)[wordIndex];
}

// Read vec4 from paged storage
fn readPagedVec4(pages: array<ptr<storage, array<vec4<f32>>>>, addr: PageAddress, index: u32) -> vec4<f32> {
    let page = pages[addr.pageIndex];
    let byteOffset = addr.offset + index * 16u;
    let vec4Index = byteOffset / 16u;
    return (*page)[vec4Index];
}
`;

export default GPUPageAllocator;
