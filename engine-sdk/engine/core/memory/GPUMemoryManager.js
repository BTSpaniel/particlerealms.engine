// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPUMemoryManager.js - WebGPU Device Memory Management
 * 
 * Implements:
 * - Ring Buffer for dynamic uniform data (per-frame)
 * - Buddy Allocator for static geometry (persistent)
 * - Texture Atlas management with LRU eviction
 * - BindGroup caching and deduplication
 * 
 * Goal: Minimize GPU API calls and prevent VRAM fragmentation
 */

import { textureFormatMipByteSize } from '../math/TextureMath.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_RING_SIZE = 16 * 1024 * 1024;     // 16MB ring buffer
const DEFAULT_BUDDY_SIZE = 64 * 1024 * 1024;    // 64MB buddy heap
const MIN_BUDDY_BLOCK = 256;                     // Minimum allocation (256 bytes)
const MAX_BUDDY_ORDER = 18;                      // 2^18 * 256 = 64MB max
const UNIFORM_ALIGNMENT = 256;                   // WebGPU uniform buffer alignment
const STORAGE_ALIGNMENT = 256;                   // Storage buffer alignment

// ============================================================================
// RING BUFFER (Dynamic Data)
// ============================================================================

/**
 * Circular buffer for per-frame dynamic data (uniforms, instance data).
 * Wraps around each frame, avoiding buffer creation overhead.
 */
export class RingBuffer {
    /**
     * @param {GPUDevice} device
     * @param {number} sizeBytes
     * @param {GPUBufferUsageFlags} usage
     * @param {string} name
     */
    constructor(device, sizeBytes = DEFAULT_RING_SIZE, usage = null, name = 'ring') {
        this.device = device;
        this.name = name;
        this.size = sizeBytes;
        
        // Default usage: uniform + copy destination
        this.usage = usage || (
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.VERTEX
        );
        
        // Create GPU buffer
        this.buffer = device.createBuffer({
            label: `RingBuffer:${name}`,
            size: sizeBytes,
            usage: this.usage,
            mappedAtCreation: false,
        });
        
        // Write cursor (CPU side)
        this.writePtr = 0;
        
        // Read cursor (GPU side) - tracks what GPU has consumed
        // In practice, we assume GPU is 2-3 frames behind
        this.frameOffsets = [0, 0, 0]; // Track start offset of last 3 frames
        this.currentFrame = 0;
        
        // Stats
        this.totalAllocated = 0;
        this.frameAllocations = 0;
        this.wrapCount = 0;
        this.peakUsage = 0;
    }
    
    /**
     * Begin a new frame - mark frame boundary
     */
    beginFrame() {
        // Store current write position for this frame
        this.frameOffsets[this.currentFrame % 3] = this.writePtr;
        this.currentFrame++;
        this.frameAllocations = 0;
    }
    
    /**
     * Allocate bytes from the ring buffer
     * @param {number} bytes - Size to allocate
     * @param {number} alignment - Byte alignment (default: UNIFORM_ALIGNMENT)
     * @returns {{ offset: number, size: number } | null}
     */
    alloc(bytes, alignment = UNIFORM_ALIGNMENT) {
        // Align write pointer
        const alignedPtr = (this.writePtr + alignment - 1) & ~(alignment - 1);
        
        // Check for wrap
        if (alignedPtr + bytes > this.size) {
            // Wrap to beginning
            this.wrapCount++;
            this.writePtr = 0;
            
            // Check if we're overwriting data GPU is still using
            const oldestFrameOffset = this.frameOffsets[(this.currentFrame - 2) % 3];
            if (bytes > oldestFrameOffset && oldestFrameOffset > 0) {
                console.warn(`[RingBuffer:${this.name}] Buffer overflow - GPU may still be reading!`);
                // In production, you'd want to stall or allocate overflow
            }
            
            return this.alloc(bytes, alignment); // Retry from start
        }
        
        const offset = alignedPtr;
        this.writePtr = alignedPtr + bytes;
        this.totalAllocated += bytes;
        this.frameAllocations++;
        this.peakUsage = Math.max(this.peakUsage, this.writePtr);
        
        return { offset, size: bytes };
    }
    
    /**
     * Write data to the ring buffer
     * @param {ArrayBuffer|TypedArray} data
     * @param {number} alignment
     * @returns {{ offset: number, size: number } | null}
     */
    write(data, alignment = UNIFORM_ALIGNMENT) {
        const bytes = data.byteLength;
        const allocation = this.alloc(bytes, alignment);
        
        if (!allocation) return null;
        
        // Upload data to GPU
        this.device.queue.writeBuffer(
            this.buffer,
            allocation.offset,
            data instanceof ArrayBuffer ? data : data.buffer,
            data.byteOffset || 0,
            bytes
        );
        
        return allocation;
    }
    
    /**
     * Get the underlying GPU buffer
     * @returns {GPUBuffer}
     */
    getBuffer() {
        return this.buffer;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            name: this.name,
            size: this.size,
            writePtr: this.writePtr,
            utilizationPercent: ((this.writePtr / this.size) * 100).toFixed(2),
            peakUtilizationPercent: ((this.peakUsage / this.size) * 100).toFixed(2),
            totalAllocated: this.totalAllocated,
            frameAllocations: this.frameAllocations,
            wrapCount: this.wrapCount,
            currentFrame: this.currentFrame,
        };
    }
    
    /**
     * Destroy the buffer
     */
    destroy() {
        this.buffer.destroy();
    }
}

// ============================================================================
// BUDDY ALLOCATOR (Static Data)
// ============================================================================

/**
 * Buddy allocator for persistent GPU memory (geometry, textures).
 * Handles allocation/deallocation without fragmentation.
 */
export class BuddyAllocator {
    /**
     * @param {GPUDevice} device
     * @param {number} sizeBytes - Total heap size (must be power of 2)
     * @param {GPUBufferUsageFlags} usage
     * @param {string} name
     */
    constructor(device, sizeBytes = DEFAULT_BUDDY_SIZE, usage = null, name = 'buddy') {
        this.device = device;
        this.name = name;
        
        // Round up to power of 2
        this.size = this._nextPowerOf2(sizeBytes);
        this.minBlock = MIN_BUDDY_BLOCK;
        
        // Calculate order (log2 of size / minBlock)
        this.maxOrder = Math.log2(this.size / this.minBlock);
        
        // Tree structure: each level has 2^level nodes
        // Node states: 0 = free, 1 = split, 2 = full
        const treeSize = (1 << (this.maxOrder + 1)) - 1;
        this.tree = new Uint8Array(treeSize);
        
        // Track allocations: offset -> { size, order }
        this.allocations = new Map();
        
        // Default usage for geometry
        this.usage = usage || (
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.INDEX |
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
        );
        
        // Create GPU buffer
        this.buffer = device.createBuffer({
            label: `BuddyAllocator:${name}`,
            size: this.size,
            usage: this.usage,
            mappedAtCreation: false,
        });
        
        // Stats
        this.totalAllocated = 0;
        this.allocationCount = 0;
        this.freeCount = 0;
        this.peakAllocated = 0;
    }
    
    _nextPowerOf2(n) {
        return 1 << Math.ceil(Math.log2(n));
    }
    
    /**
     * Get tree node index for given order and index within that order
     */
    _nodeIndex(order, indexInOrder) {
        return (1 << (this.maxOrder - order)) - 1 + indexInOrder;
    }
    
    /**
     * Allocate memory from the buddy heap
     * @param {number} bytes
     * @returns {{ offset: number, size: number } | null}
     */
    alloc(bytes) {
        // Find smallest order that fits
        const blockSize = Math.max(this.minBlock, this._nextPowerOf2(bytes));
        const order = Math.log2(blockSize / this.minBlock);
        
        if (order > this.maxOrder) {
            console.error(`[BuddyAllocator:${this.name}] Allocation too large: ${bytes}`);
            return null;
        }
        
        // Find free block at this order (or split larger block)
        const result = this._allocBlock(0, 0, this.maxOrder, order);
        
        if (result === null) {
            console.warn(`[BuddyAllocator:${this.name}] Out of memory for ${bytes} bytes`);
            return null;
        }
        
        const offset = result.offset;
        const size = blockSize;
        
        // Track allocation
        this.allocations.set(offset, { size, order });
        this.totalAllocated += size;
        this.allocationCount++;
        this.peakAllocated = Math.max(this.peakAllocated, this.totalAllocated);
        
        return { offset, size };
    }
    
    /**
     * Recursive block allocation
     */
    _allocBlock(nodeIdx, offset, currentOrder, targetOrder) {
        const state = this.tree[nodeIdx];
        
        if (state === 2) {
            // Node is full
            return null;
        }
        
        if (currentOrder === targetOrder) {
            // Found block at target order
            if (state === 0) {
                // Free - allocate it
                this.tree[nodeIdx] = 2; // Mark as full
                this._updateParents(nodeIdx);
                return { offset };
            }
            return null; // Not available
        }
        
        // Need to go deeper
        if (state === 0) {
            // Free block - split it
            this.tree[nodeIdx] = 1; // Mark as split
        }
        
        // Try left child first
        const leftChild = nodeIdx * 2 + 1;
        const rightChild = nodeIdx * 2 + 2;
        const childBlockSize = (1 << (currentOrder - 1)) * this.minBlock;
        
        let result = this._allocBlock(leftChild, offset, currentOrder - 1, targetOrder);
        if (result) return result;
        
        // Try right child
        result = this._allocBlock(rightChild, offset + childBlockSize, currentOrder - 1, targetOrder);
        if (result) return result;
        
        return null;
    }
    
    /**
     * Update parent nodes after allocation
     */
    _updateParents(nodeIdx) {
        while (nodeIdx > 0) {
            const parentIdx = Math.floor((nodeIdx - 1) / 2);
            const siblingIdx = nodeIdx % 2 === 1 ? nodeIdx + 1 : nodeIdx - 1;
            
            const nodeState = this.tree[nodeIdx];
            const siblingState = this.tree[siblingIdx];
            
            if (nodeState === 2 && siblingState === 2) {
                // Both children full - parent is full
                this.tree[parentIdx] = 2;
            } else {
                // Parent is split (has some free space)
                this.tree[parentIdx] = 1;
            }
            
            nodeIdx = parentIdx;
        }
    }
    
    /**
     * Free previously allocated memory
     * @param {number} offset
     */
    free(offset) {
        const allocation = this.allocations.get(offset);
        if (!allocation) {
            console.warn(`[BuddyAllocator:${this.name}] Invalid free at offset ${offset}`);
            return;
        }
        
        const { size, order } = allocation;
        
        // Find the node and mark as free
        this._freeBlock(0, 0, this.maxOrder, offset, order);
        
        // Remove tracking
        this.allocations.delete(offset);
        this.totalAllocated -= size;
        this.freeCount++;
    }
    
    /**
     * Recursive block freeing with coalescing
     */
    _freeBlock(nodeIdx, nodeOffset, currentOrder, targetOffset, targetOrder) {
        if (currentOrder === targetOrder && nodeOffset === targetOffset) {
            // Found the block
            this.tree[nodeIdx] = 0; // Mark as free
            this._coalesce(nodeIdx);
            return true;
        }
        
        if (currentOrder <= targetOrder) {
            return false;
        }
        
        const childBlockSize = (1 << (currentOrder - 1)) * this.minBlock;
        const leftChild = nodeIdx * 2 + 1;
        const rightChild = nodeIdx * 2 + 2;
        
        if (targetOffset < nodeOffset + childBlockSize) {
            return this._freeBlock(leftChild, nodeOffset, currentOrder - 1, targetOffset, targetOrder);
        } else {
            return this._freeBlock(rightChild, nodeOffset + childBlockSize, currentOrder - 1, targetOffset, targetOrder);
        }
    }
    
    /**
     * Coalesce buddies after freeing
     */
    _coalesce(nodeIdx) {
        while (nodeIdx > 0) {
            const parentIdx = Math.floor((nodeIdx - 1) / 2);
            const siblingIdx = nodeIdx % 2 === 1 ? nodeIdx + 1 : nodeIdx - 1;
            
            // If both children are free, merge into parent
            if (this.tree[nodeIdx] === 0 && this.tree[siblingIdx] === 0) {
                this.tree[parentIdx] = 0; // Parent becomes free
                nodeIdx = parentIdx;
            } else {
                // Can't merge further
                this.tree[parentIdx] = 1; // Parent is split
                break;
            }
        }
    }
    
    /**
     * Write data to allocated region
     * @param {number} offset
     * @param {ArrayBuffer|TypedArray} data
     */
    write(offset, data) {
        this.device.queue.writeBuffer(
            this.buffer,
            offset,
            data instanceof ArrayBuffer ? data : data.buffer,
            data.byteOffset || 0,
            data.byteLength
        );
    }
    
    /**
     * Allocate and write in one call
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ offset: number, size: number } | null}
     */
    allocAndWrite(data) {
        const allocation = this.alloc(data.byteLength);
        if (allocation) {
            this.write(allocation.offset, data);
        }
        return allocation;
    }
    
    /**
     * Get the underlying GPU buffer
     * @returns {GPUBuffer}
     */
    getBuffer() {
        return this.buffer;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            name: this.name,
            totalSize: this.size,
            allocated: this.totalAllocated,
            free: this.size - this.totalAllocated,
            utilizationPercent: ((this.totalAllocated / this.size) * 100).toFixed(2),
            peakUtilizationPercent: ((this.peakAllocated / this.size) * 100).toFixed(2),
            allocationCount: this.allocationCount,
            freeCount: this.freeCount,
            activeAllocations: this.allocations.size,
        };
    }
    
    /**
     * Destroy the buffer
     */
    destroy() {
        this.buffer.destroy();
        this.allocations.clear();
    }
}

// ============================================================================
// STAGING BUFFER POOL
// ============================================================================

/**
 * Pool of mappable staging buffers for CPU->GPU transfers.
 * Avoids creating new buffers for every upload.
 */
export class StagingBufferPool {
    /**
     * @param {GPUDevice} device
     * @param {number} pageSize - Size of each staging buffer
     * @param {number} maxPages - Maximum buffers in pool
     */
    constructor(device, pageSize = 4 * 1024 * 1024, maxPages = 8) {
        this.device = device;
        this.pageSize = pageSize;
        this.maxPages = maxPages;
        
        // Available staging buffers
        this.available = [];
        
        // In-flight staging buffers (being used by GPU)
        this.inFlight = [];
        
        // Pre-allocate a few buffers
        for (let i = 0; i < 2; i++) {
            this.available.push(this._createBuffer());
        }
    }
    
    _createBuffer() {
        return this.device.createBuffer({
            label: 'StagingBuffer',
            size: this.pageSize,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
    }
    
    /**
     * Get a staging buffer for writing
     * @returns {Promise<{ buffer: GPUBuffer, arrayBuffer: ArrayBuffer }>}
     */
    async acquire() {
        // Check for returned buffers
        await this._reclaimBuffers();
        
        let buffer;
        
        if (this.available.length > 0) {
            buffer = this.available.pop();
            // Map it for writing
            await buffer.mapAsync(GPUMapMode.WRITE);
        } else if (this.available.length + this.inFlight.length < this.maxPages) {
            // Create new buffer (already mapped at creation)
            buffer = this._createBuffer();
        } else {
            // Wait for a buffer to become available
            console.warn('[StagingBufferPool] Waiting for buffer...');
            await this._reclaimBuffers();
            if (this.available.length > 0) {
                buffer = this.available.pop();
                await buffer.mapAsync(GPUMapMode.WRITE);
            } else {
                throw new Error('Staging buffer pool exhausted');
            }
        }
        
        return {
            buffer,
            arrayBuffer: buffer.getMappedRange(),
        };
    }
    
    /**
     * Release a staging buffer after use
     * @param {GPUBuffer} buffer
     */
    release(buffer) {
        buffer.unmap();
        this.inFlight.push({
            buffer,
            timestamp: performance.now(),
        });
    }
    
    /**
     * Reclaim buffers that GPU has finished with
     */
    async _reclaimBuffers() {
        const now = performance.now();
        const reclaimAge = 32; // ~2 frames at 60fps
        
        for (let i = this.inFlight.length - 1; i >= 0; i--) {
            const entry = this.inFlight[i];
            if (now - entry.timestamp > reclaimAge) {
                this.inFlight.splice(i, 1);
                this.available.push(entry.buffer);
            }
        }
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            pageSize: this.pageSize,
            available: this.available.length,
            inFlight: this.inFlight.length,
            total: this.available.length + this.inFlight.length,
            maxPages: this.maxPages,
        };
    }
    
    /**
     * Destroy all buffers
     */
    destroy() {
        for (const buffer of this.available) {
            buffer.destroy();
        }
        for (const entry of this.inFlight) {
            entry.buffer.destroy();
        }
        this.available.length = 0;
        this.inFlight.length = 0;
    }
}

// ============================================================================
// BIND GROUP CACHE
// ============================================================================

/**
 * Cache for GPUBindGroup objects to avoid redundant creation.
 * Uses content-based hashing for deduplication.
 */
export class BindGroupCache {
    /**
     * @param {GPUDevice} device
     * @param {number} maxEntries - Maximum cache size
     */
    constructor(device, maxEntries = 4096) {
        this.device = device;
        this.maxEntries = maxEntries;

        this._idByObject = new WeakMap();
        this._nextObjectId = 1;
        
        // Cache: hash -> { bindGroup, lastUsed, useCount }
        this.cache = new Map();
        
        // LRU tracking
        this.accessOrder = [];
        
        // Stats
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }
    
    /**
     * Generate hash key for bind group descriptor
     * @param {GPUBindGroupLayout} layout
     * @param {GPUBindGroupEntry[]} entries
     * @returns {string}
     */
    _generateKey(layout, entries) {
        const parts = [`l:${this._getObjectId(layout)}`];
        
        for (const entry of entries) {
            parts.push(`${entry.binding}:`);
            
            if (entry.resource.buffer) {
                const r = entry.resource;
                parts.push(`b:${this._getObjectId(r.buffer)}:${r.offset || 0}:${r.size || 0}`);
            } else if (entry.resource instanceof GPUSampler) {
                parts.push(`s:${this._getObjectId(entry.resource)}`);
            } else if (entry.resource instanceof GPUTextureView) {
                parts.push(`t:${this._getObjectId(entry.resource)}`);
            } else {
                parts.push(`u:${this._getObjectId(entry.resource)}`);
            }
        }
        
        return parts.join('|');
    }

    _getObjectId(obj) {
        if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
            return 0;
        }
        let id = this._idByObject.get(obj);
        if (!id) {
            id = this._nextObjectId++;
            this._idByObject.set(obj, id);
        }
        return id;
    }
    
    /**
     * Get or create a bind group
     * @param {GPUBindGroupLayout} layout
     * @param {GPUBindGroupEntry[]} entries
     * @param {string} label
     * @returns {GPUBindGroup}
     */
    getOrCreate(layout, entries, label = '') {
        const key = this._generateKey(layout, entries);
        
        let cached = this.cache.get(key);
        
        if (cached) {
            // Cache hit
            this.hits++;
            cached.lastUsed = performance.now();
            cached.useCount++;
            return cached.bindGroup;
        }
        
        // Cache miss - create new bind group
        this.misses++;
        
        const bindGroup = this.device.createBindGroup({
            label: label || `Cached:${key.substring(0, 32)}`,
            layout,
            entries,
        });
        
        // Evict if necessary
        if (this.cache.size >= this.maxEntries) {
            this._evictLRU();
        }
        
        // Store in cache
        this.cache.set(key, {
            bindGroup,
            lastUsed: performance.now(),
            useCount: 1,
        });
        
        return bindGroup;
    }
    
    /**
     * Evict least recently used entries
     */
    _evictLRU() {
        // Find oldest entry
        let oldestKey = null;
        let oldestTime = Infinity;
        
        for (const [key, entry] of this.cache) {
            if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.evictions++;
        }
    }
    
    /**
     * Clear the cache
     */
    clear() {
        this.cache.clear();
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const hitRate = this.hits + this.misses > 0
            ? (this.hits / (this.hits + this.misses) * 100).toFixed(2)
            : 0;
            
        return {
            size: this.cache.size,
            maxEntries: this.maxEntries,
            hits: this.hits,
            misses: this.misses,
            hitRate: `${hitRate}%`,
            evictions: this.evictions,
        };
    }
}

// ============================================================================
// TEXTURE MANAGER WITH LRU
// ============================================================================

/**
 * Manages GPU textures with LRU eviction policy.
 */
export class TextureManager {
    /**
     * @param {GPUDevice} device
     * @param {number} budgetBytes - VRAM budget for textures
     */
    constructor(device, budgetBytes = 512 * 1024 * 1024) {
        this.device = device;
        this.budget = budgetBytes;
        this.currentUsage = 0;
        
        // Texture storage: id -> { texture, view, size, lastUsed }
        this.textures = new Map();
        
        // LRU list (doubly linked via Map ordering)
        this.lruOrder = [];
        
        // Stats
        this.loadCount = 0;
        this.evictionCount = 0;
    }
    
    /**
     * Calculate texture memory size
     */
    _calculateSize(width, height, format, mipLevels = 1) {
        const size = textureFormatMipByteSize(width, height, format, mipLevels);
        
        
        return size;
    }
    
    /**
     * Create or get a texture
     * @param {string} id - Unique texture identifier
     * @param {GPUTextureDescriptor} descriptor
     * @returns {{ texture: GPUTexture, view: GPUTextureView }}
     */
    create(id, descriptor) {
        // Check if already exists
        if (this.textures.has(id)) {
            const entry = this.textures.get(id);
            entry.lastUsed = performance.now();
            return { texture: entry.texture, view: entry.view };
        }
        
        const size = this._calculateSize(
            descriptor.size.width || descriptor.size[0],
            descriptor.size.height || descriptor.size[1],
            descriptor.format,
            descriptor.mipLevelCount || 1
        );
        
        // Evict if over budget
        while (this.currentUsage + size > this.budget && this.textures.size > 0) {
            this._evictLRU();
        }
        
        // Create texture
        const texture = this.device.createTexture({
            label: `Texture:${id}`,
            ...descriptor,
        });
        
        const view = texture.createView({
            label: `TextureView:${id}`,
        });
        
        // Store
        this.textures.set(id, {
            texture,
            view,
            size,
            lastUsed: performance.now(),
            descriptor,
        });
        
        this.currentUsage += size;
        this.loadCount++;
        
        return { texture, view };
    }
    
    /**
     * Get texture by ID (marks as recently used)
     * @param {string} id
     * @returns {{ texture: GPUTexture, view: GPUTextureView } | null}
     */
    get(id) {
        const entry = this.textures.get(id);
        if (entry) {
            entry.lastUsed = performance.now();
            return { texture: entry.texture, view: entry.view };
        }
        return null;
    }
    
    /**
     * Evict least recently used texture
     */
    _evictLRU() {
        let oldestId = null;
        let oldestTime = Infinity;
        
        for (const [id, entry] of this.textures) {
            if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestId = id;
            }
        }
        
        if (oldestId) {
            const entry = this.textures.get(oldestId);
            entry.texture.destroy();
            this.currentUsage -= entry.size;
            this.textures.delete(oldestId);
            this.evictionCount++;
            console.log(`[TextureManager] Evicted texture: ${oldestId}`);
        }
    }
    
    /**
     * Manually destroy a texture
     * @param {string} id
     */
    destroy(id) {
        const entry = this.textures.get(id);
        if (entry) {
            entry.texture.destroy();
            this.currentUsage -= entry.size;
            this.textures.delete(id);
        }
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            textureCount: this.textures.size,
            currentUsage: this.currentUsage,
            budget: this.budget,
            utilizationPercent: ((this.currentUsage / this.budget) * 100).toFixed(2),
            loadCount: this.loadCount,
            evictionCount: this.evictionCount,
        };
    }
    
    /**
     * Destroy all textures
     */
    destroyAll() {
        for (const entry of this.textures.values()) {
            entry.texture.destroy();
        }
        this.textures.clear();
        this.currentUsage = 0;
    }
}

// ============================================================================
// GPU MEMORY MANAGER (Facade)
// ============================================================================

/**
 * Central GPU memory management facade.
 */
export class GPUMemoryManager {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.device = device;
        this.initialized = false;
        
        // Sub-managers
        this.uniformRing = null;
        this.vertexRing = null;
        this.geometryHeap = null;
        this.stagingPool = null;
        this.bindGroupCache = null;
        this.textureManager = null;
        
        // Stats
        this.frameCount = 0;
    }
    
    /**
     * Initialize all sub-managers
     * @param {Object} options
     */
    init(options = {}) {
        const {
            uniformRingSize = 8 * 1024 * 1024,    // 8MB uniforms
            vertexRingSize = 16 * 1024 * 1024,    // 16MB dynamic vertices
            geometryHeapSize = 64 * 1024 * 1024,  // 64MB static geometry
            textureBudget = 512 * 1024 * 1024,    // 512MB textures
        } = options;
        
        // Uniform ring buffer
        this.uniformRing = new RingBuffer(
            this.device,
            uniformRingSize,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            'uniforms'
        );
        
        // Vertex/instance data ring buffer
        this.vertexRing = new RingBuffer(
            this.device,
            vertexRingSize,
            GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            'vertices'
        );
        
        // Static geometry heap
        this.geometryHeap = new BuddyAllocator(
            this.device,
            geometryHeapSize,
            GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            'geometry'
        );
        
        // Staging buffer pool
        this.stagingPool = new StagingBufferPool(this.device);
        
        // Bind group cache
        this.bindGroupCache = new BindGroupCache(this.device);
        
        // Texture manager
        this.textureManager = new TextureManager(this.device, textureBudget);
        
        this.initialized = true;
        console.log('[GPUMemoryManager] Initialized');
    }
    
    /**
     * Begin new frame
     */
    beginFrame() {
        this.frameCount++;
        this.uniformRing?.beginFrame();
        this.vertexRing?.beginFrame();
    }
    
    /**
     * Allocate uniform data
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocUniform(data) {
        const allocation = this.uniformRing.write(data, UNIFORM_ALIGNMENT);
        return {
            buffer: this.uniformRing.getBuffer(),
            offset: allocation.offset,
            size: allocation.size,
        };
    }
    
    /**
     * Allocate vertex data (dynamic, per-frame)
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocVertexDynamic(data) {
        const allocation = this.vertexRing.write(data, 4);
        return {
            buffer: this.vertexRing.getBuffer(),
            offset: allocation.offset,
            size: allocation.size,
        };
    }
    
    /**
     * Allocate static geometry
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocGeometry(data) {
        const allocation = this.geometryHeap.allocAndWrite(data);
        return {
            buffer: this.geometryHeap.getBuffer(),
            offset: allocation.offset,
            size: allocation.size,
        };
    }
    
    /**
     * Free static geometry
     * @param {number} offset
     */
    freeGeometry(offset) {
        this.geometryHeap.free(offset);
    }
    
    /**
     * Get or create bind group
     */
    getBindGroup(layout, entries, label) {
        return this.bindGroupCache.getOrCreate(layout, entries, label);
    }
    
    /**
     * Get comprehensive statistics
     */
    getStats() {
        return {
            frameCount: this.frameCount,
            uniformRing: this.uniformRing?.getStats(),
            vertexRing: this.vertexRing?.getStats(),
            geometryHeap: this.geometryHeap?.getStats(),
            stagingPool: this.stagingPool?.getStats(),
            bindGroupCache: this.bindGroupCache?.getStats(),
            textureManager: this.textureManager?.getStats(),
        };
    }
    
    /**
     * Log memory report
     */
    logReport() {
        const stats = this.getStats();
        console.group('[GPUMemoryManager] Memory Report');
        console.log(`Frame: ${stats.frameCount}`);
        
        if (stats.uniformRing) {
            console.log(`Uniform Ring: ${stats.uniformRing.utilizationPercent}% (${stats.uniformRing.frameAllocations} allocs)`);
        }
        if (stats.vertexRing) {
            console.log(`Vertex Ring: ${stats.vertexRing.utilizationPercent}%`);
        }
        if (stats.geometryHeap) {
            console.log(`Geometry Heap: ${stats.geometryHeap.utilizationPercent}% (${stats.geometryHeap.activeAllocations} active)`);
        }
        if (stats.bindGroupCache) {
            console.log(`BindGroup Cache: ${stats.bindGroupCache.size} entries, ${stats.bindGroupCache.hitRate} hit rate`);
        }
        if (stats.textureManager) {
            console.log(`Textures: ${stats.textureManager.textureCount}, ${stats.textureManager.utilizationPercent}% budget`);
        }
        
        console.groupEnd();
    }
    
    /**
     * Handle device loss - prepare for reinitialization
     */
    handleDeviceLoss() {
        // Clear all caches and references
        this.bindGroupCache?.clear();
        this.textureManager?.destroyAll();
        this.initialized = false;
        console.warn('[GPUMemoryManager] Device lost - cleared caches');
    }
    
    /**
     * Destroy all resources
     */
    destroy() {
        this.uniformRing?.destroy();
        this.vertexRing?.destroy();
        this.geometryHeap?.destroy();
        this.stagingPool?.destroy();
        this.textureManager?.destroyAll();
        this.bindGroupCache?.clear();
        this.initialized = false;
    }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let gpuMemoryInstance = null;

/**
 * Get or create GPU memory manager singleton
 * @param {GPUDevice} device
 * @returns {GPUMemoryManager}
 */
export function getGPUMemoryManager(device) {
    if (device) {
        if (!gpuMemoryInstance || gpuMemoryInstance.device !== device) {
            gpuMemoryInstance = new GPUMemoryManager(device);
        }
    }
    return gpuMemoryInstance;
}

export default GPUMemoryManager;
