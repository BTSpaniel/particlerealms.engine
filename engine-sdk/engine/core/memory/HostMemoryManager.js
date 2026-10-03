// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HostMemoryManager.js - Zero-Runtime-Allocation Memory System
 * 
 * Implements:
 * - Slab Allocator for TypedArrays (per-frame linear allocation)
 * - Object Pools for reusable JS objects (persistent lifecycle)
 * - Structure of Arrays (SoA) for cache-efficient data layouts
 * 
 * Goal: Eliminate GC pressure during the render loop
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SLAB_SIZE = 64 * 1024 * 1024;  // 64MB default slab
const DEFAULT_POOL_CAPACITY = 1024;
const ALIGNMENT_4 = 4;    // Float alignment
const ALIGNMENT_16 = 16;  // SIMD alignment
const ALIGNMENT_256 = 256; // Uniform buffer alignment

// ============================================================================
// SLAB ALLOCATOR
// ============================================================================

/**
 * Linear allocator that resets every frame.
 * Provides zero-cost TypedArray views into a pre-allocated buffer.
 */
export class SlabAllocator {
    /**
     * @param {number} sizeBytes - Total slab size in bytes
     * @param {string} name - Debug name for this slab
     */
    constructor(sizeBytes = DEFAULT_SLAB_SIZE, name = 'default') {
        this.name = name;
        this.size = sizeBytes;
        this.buffer = new ArrayBuffer(sizeBytes);
        this.writeCursor = 0;
        this.peakUsage = 0;
        this.allocCount = 0;
        
        // Pre-create typed array views for the entire buffer
        this.uint8View = new Uint8Array(this.buffer);
        this.uint16View = new Uint16Array(this.buffer);
        this.uint32View = new Uint32Array(this.buffer);
        this.int32View = new Int32Array(this.buffer);
        this.float32View = new Float32Array(this.buffer);
        this.float64View = new Float64Array(this.buffer);
        
        // Overflow pages for when main slab is exhausted
        this.overflowPages = [];
        this.currentOverflowPage = null;
        this.overflowCursor = 0;
    }
    
    /**
     * Align cursor to specified boundary
     * @param {number} alignment - Byte alignment (must be power of 2)
     * @returns {number} Aligned cursor position
     */
    _align(alignment) {
        const mask = alignment - 1;
        return (this.writeCursor + mask) & ~mask;
    }
    
    /**
     * Allocate raw bytes from the slab
     * @param {number} bytes - Number of bytes to allocate
     * @param {number} alignment - Byte alignment requirement
     * @returns {number} Offset into the buffer
     */
    allocBytes(bytes, alignment = ALIGNMENT_4) {
        const alignedCursor = this._align(alignment);
        
        if (alignedCursor + bytes > this.size) {
            // Overflow to secondary page
            return this._allocOverflow(bytes, alignment);
        }
        
        const offset = alignedCursor;
        this.writeCursor = alignedCursor + bytes;
        this.peakUsage = Math.max(this.peakUsage, this.writeCursor);
        this.allocCount++;
        
        return offset;
    }
    
    /**
     * Allocate from overflow page when main slab is full
     */
    _allocOverflow(bytes, alignment) {
        // Create new overflow page if needed
        if (!this.currentOverflowPage || this.overflowCursor + bytes > this.currentOverflowPage.byteLength) {
            const pageSize = Math.max(bytes * 2, 1024 * 1024); // At least 1MB or 2x request
            this.currentOverflowPage = new ArrayBuffer(pageSize);
            this.overflowPages.push(this.currentOverflowPage);
            this.overflowCursor = 0;
            console.warn(`[SlabAllocator:${this.name}] Overflow page allocated: ${pageSize} bytes`);
        }
        
        const mask = alignment - 1;
        const alignedCursor = (this.overflowCursor + mask) & ~mask;
        const offset = alignedCursor;
        this.overflowCursor = alignedCursor + bytes;
        
        // Return negative offset to indicate overflow (caller must handle)
        return -(this.overflowPages.length * 0x10000000 + offset);
    }
    
    /**
     * Allocate a Float32Array view
     * @param {number} count - Number of floats
     * @returns {Float32Array} View into the slab
     */
    allocFloat32(count) {
        const bytes = count * 4;
        const offset = this.allocBytes(bytes, ALIGNMENT_4);
        
        if (offset < 0) {
            // Overflow allocation - create new array
            const pageIdx = Math.floor(-offset / 0x10000000);
            const pageOffset = -offset % 0x10000000;
            return new Float32Array(this.overflowPages[pageIdx - 1], pageOffset, count);
        }
        
        return new Float32Array(this.buffer, offset, count);
    }
    
    /**
     * Allocate a Uint32Array view
     * @param {number} count - Number of uint32s
     * @returns {Uint32Array}
     */
    allocUint32(count) {
        const bytes = count * 4;
        const offset = this.allocBytes(bytes, ALIGNMENT_4);
        
        if (offset < 0) {
            const pageIdx = Math.floor(-offset / 0x10000000);
            const pageOffset = -offset % 0x10000000;
            return new Uint32Array(this.overflowPages[pageIdx - 1], pageOffset, count);
        }
        
        return new Uint32Array(this.buffer, offset, count);
    }
    
    /**
     * Allocate a Uint8Array view
     * @param {number} count - Number of bytes
     * @returns {Uint8Array}
     */
    allocUint8(count) {
        const offset = this.allocBytes(count, 1);
        
        if (offset < 0) {
            const pageIdx = Math.floor(-offset / 0x10000000);
            const pageOffset = -offset % 0x10000000;
            return new Uint8Array(this.overflowPages[pageIdx - 1], pageOffset, count);
        }
        
        return new Uint8Array(this.buffer, offset, count);
    }
    
    /**
     * Allocate a 4x4 matrix (16 floats, 64 bytes)
     * @returns {Float32Array}
     */
    allocMatrix4() {
        return this.allocFloat32(16);
    }
    
    /**
     * Allocate a Vec3 (3 floats, padded to 4 for alignment)
     * @returns {Float32Array}
     */
    allocVec3() {
        return this.allocFloat32(4); // Pad to vec4 for GPU alignment
    }
    
    /**
     * Allocate a Vec4 (4 floats)
     * @returns {Float32Array}
     */
    allocVec4() {
        return this.allocFloat32(4);
    }
    
    /**
     * Allocate uniform buffer aligned memory
     * @param {number} bytes - Size in bytes
     * @returns {Uint8Array}
     */
    allocUniformBuffer(bytes) {
        const offset = this.allocBytes(bytes, ALIGNMENT_256);
        
        if (offset < 0) {
            const pageIdx = Math.floor(-offset / 0x10000000);
            const pageOffset = -offset % 0x10000000;
            return new Uint8Array(this.overflowPages[pageIdx - 1], pageOffset, bytes);
        }
        
        return new Uint8Array(this.buffer, offset, bytes);
    }
    
    /**
     * Reset the allocator for a new frame
     * Call this at the START of each frame
     */
    reset() {
        this.writeCursor = 0;
        this.allocCount = 0;
        
        // Clear overflow pages (they will be GC'd eventually, but that's okay
        // since overflow is exceptional)
        if (this.overflowPages.length > 0) {
            console.warn(`[SlabAllocator:${this.name}] ${this.overflowPages.length} overflow pages used last frame`);
            this.overflowPages.length = 0;
            this.currentOverflowPage = null;
            this.overflowCursor = 0;
        }
    }
    
    /**
     * Get usage statistics
     * @returns {Object}
     */
    getStats() {
        return {
            name: this.name,
            totalSize: this.size,
            currentUsage: this.writeCursor,
            peakUsage: this.peakUsage,
            utilizationPercent: ((this.writeCursor / this.size) * 100).toFixed(2),
            peakUtilizationPercent: ((this.peakUsage / this.size) * 100).toFixed(2),
            allocCount: this.allocCount,
            overflowPages: this.overflowPages.length,
        };
    }
}

// ============================================================================
// OBJECT POOL
// ============================================================================

/**
 * Generic object pool for reusable JavaScript objects.
 * Uses LIFO (stack) for hot cache retrieval.
 */
export class ObjectPool {
    /**
     * @param {Function} factory - Function that creates new objects
     * @param {Function} reset - Function that resets an object for reuse
     * @param {number} initialCapacity - Initial pool size
     * @param {string} name - Debug name
     */
    constructor(factory, reset = null, initialCapacity = DEFAULT_POOL_CAPACITY, name = 'pool') {
        this.name = name;
        this.factory = factory;
        this.resetFn = reset || ((obj) => obj);
        
        // Pre-allocate pool storage
        this.items = new Array(initialCapacity);
        this.capacity = initialCapacity;
        this.freeIndex = initialCapacity; // Points to next free slot (stack top)
        
        // Stats
        this.totalCreated = 0;
        this.totalAcquired = 0;
        this.totalReleased = 0;
        this.peakInUse = 0;
        
        // Pre-populate pool
        for (let i = 0; i < initialCapacity; i++) {
            this.items[i] = this._createObject();
        }
        
        // Debug mode: seal objects to prevent property additions
        this.debugMode = false;
    }
    
    /**
     * Create a new object via factory
     */
    _createObject() {
        const obj = this.factory();
        this.totalCreated++;
        
        // In debug mode, seal object to catch shape violations
        if (this.debugMode && obj && typeof obj === 'object') {
            Object.seal(obj);
        }
        
        return obj;
    }
    
    /**
     * Acquire an object from the pool
     * @returns {Object}
     */
    alloc() {
        this.totalAcquired++;
        
        if (this.freeIndex > 0) {
            // Pop from stack
            const obj = this.items[--this.freeIndex];
            this.items[this.freeIndex] = null; // Clear reference
            
            const inUse = this.capacity - this.freeIndex;
            this.peakInUse = Math.max(this.peakInUse, inUse);
            
            return obj;
        }
        
        // Pool exhausted - expand
        this._expand();
        return this.alloc();
    }
    
    /**
     * Release an object back to the pool
     * @param {Object} obj
     */
    free(obj) {
        if (!obj) return;
        
        this.totalReleased++;
        
        // Reset object state
        this.resetFn(obj);
        
        // Expand if needed
        if (this.freeIndex >= this.capacity) {
            this._expand();
        }
        
        // Push to stack
        this.items[this.freeIndex++] = obj;
    }
    
    /**
     * Expand pool capacity
     */
    _expand() {
        const newCapacity = this.capacity * 2;
        const newItems = new Array(newCapacity);
        
        // Copy existing items
        for (let i = 0; i < this.capacity; i++) {
            newItems[i] = this.items[i];
        }
        
        // Fill new slots with fresh objects
        for (let i = this.capacity; i < newCapacity; i++) {
            newItems[i] = this._createObject();
        }
        
        // Update freeIndex to point to new items
        this.freeIndex = newCapacity;
        
        this.items = newItems;
        this.capacity = newCapacity;
        
        console.warn(`[ObjectPool:${this.name}] Expanded to ${newCapacity} items`);
    }
    
    /**
     * Pre-warm the pool by allocating and immediately freeing
     * @param {number} count
     */
    prewarm(count) {
        const temp = [];
        for (let i = 0; i < count; i++) {
            temp.push(this.alloc());
        }
        for (const obj of temp) {
            this.free(obj);
        }
    }
    
    /**
     * Get pool statistics
     * @returns {Object}
     */
    getStats() {
        const inUse = this.totalAcquired - this.totalReleased;
        return {
            name: this.name,
            capacity: this.capacity,
            available: this.freeIndex,
            inUse: inUse,
            peakInUse: this.peakInUse,
            totalCreated: this.totalCreated,
            totalAcquired: this.totalAcquired,
            totalReleased: this.totalReleased,
            utilizationPercent: ((inUse / this.capacity) * 100).toFixed(2),
        };
    }
    
    /**
     * Enable debug mode (seals new objects)
     */
    enableDebugMode() {
        this.debugMode = true;
    }
}

// ============================================================================
// STRUCTURE OF ARRAYS (SoA) CONTAINER
// ============================================================================

/**
 * SoA container for cache-efficient mass entity storage.
 * All properties stored in contiguous TypedArrays.
 */
export class SoAContainer {
    /**
     * @param {Object} schema - Property definitions { name: { type: 'f32'|'u32'|'u8'|'i32', size: 1-4 }}
     * @param {number} capacity - Maximum entities
     * @param {string} name - Debug name
     */
    constructor(schema, capacity, name = 'soa') {
        this.name = name;
        this.schema = schema;
        this.capacity = capacity;
        this.count = 0;
        
        // Allocate arrays for each property
        this.arrays = {};
        this.bytesPerEntity = 0;
        
        for (const [propName, propDef] of Object.entries(schema)) {
            const elementCount = capacity * (propDef.size || 1);
            
            switch (propDef.type) {
                case 'f32':
                    this.arrays[propName] = new Float32Array(elementCount);
                    this.bytesPerEntity += 4 * (propDef.size || 1);
                    break;
                case 'f64':
                    this.arrays[propName] = new Float64Array(elementCount);
                    this.bytesPerEntity += 8 * (propDef.size || 1);
                    break;
                case 'u32':
                    this.arrays[propName] = new Uint32Array(elementCount);
                    this.bytesPerEntity += 4 * (propDef.size || 1);
                    break;
                case 'i32':
                    this.arrays[propName] = new Int32Array(elementCount);
                    this.bytesPerEntity += 4 * (propDef.size || 1);
                    break;
                case 'u16':
                    this.arrays[propName] = new Uint16Array(elementCount);
                    this.bytesPerEntity += 2 * (propDef.size || 1);
                    break;
                case 'u8':
                    this.arrays[propName] = new Uint8Array(elementCount);
                    this.bytesPerEntity += 1 * (propDef.size || 1);
                    break;
                default:
                    throw new Error(`Unknown type: ${propDef.type}`);
            }
        }
        
        // Active flags (bitset for compaction)
        this.active = new Uint8Array(Math.ceil(capacity / 8));
        
        // Free list for recycling indices
        this.freeList = [];
        this.nextFreeIndex = 0;
    }
    
    /**
     * Allocate a new entity slot
     * @returns {number} Entity index, or -1 if full
     */
    alloc() {
        let index;
        
        if (this.freeList.length > 0) {
            index = this.freeList.pop();
        } else if (this.nextFreeIndex < this.capacity) {
            index = this.nextFreeIndex++;
        } else {
            console.warn(`[SoAContainer:${this.name}] Capacity exhausted`);
            return -1;
        }
        
        // Mark as active
        const byteIdx = index >> 3;
        const bitIdx = index & 7;
        this.active[byteIdx] |= (1 << bitIdx);
        
        this.count++;
        return index;
    }
    
    /**
     * Free an entity slot
     * @param {number} index
     */
    free(index) {
        if (index < 0 || index >= this.nextFreeIndex) return;
        
        // Clear active bit
        const byteIdx = index >> 3;
        const bitIdx = index & 7;
        this.active[byteIdx] &= ~(1 << bitIdx);
        
        // Add to free list
        this.freeList.push(index);
        this.count--;
    }
    
    /**
     * Check if entity is active
     * @param {number} index
     * @returns {boolean}
     */
    isActive(index) {
        const byteIdx = index >> 3;
        const bitIdx = index & 7;
        return (this.active[byteIdx] & (1 << bitIdx)) !== 0;
    }
    
    /**
     * Get property value for entity
     * @param {string} propName
     * @param {number} index
     * @param {number} component - For multi-component properties (0-3)
     * @returns {number}
     */
    get(propName, index, component = 0) {
        const propDef = this.schema[propName];
        const size = propDef.size || 1;
        return this.arrays[propName][index * size + component];
    }
    
    /**
     * Set property value for entity
     * @param {string} propName
     * @param {number} index
     * @param {number} value
     * @param {number} component
     */
    set(propName, index, value, component = 0) {
        const propDef = this.schema[propName];
        const size = propDef.size || 1;
        this.arrays[propName][index * size + component] = value;
    }
    
    /**
     * Set all components of a property
     * @param {string} propName
     * @param {number} index
     * @param {...number} values
     */
    setAll(propName, index, ...values) {
        const propDef = this.schema[propName];
        const size = propDef.size || 1;
        const arr = this.arrays[propName];
        const base = index * size;
        
        for (let i = 0; i < Math.min(values.length, size); i++) {
            arr[base + i] = values[i];
        }
    }
    
    /**
     * Get raw array for direct access (faster for bulk operations)
     * @param {string} propName
     * @returns {TypedArray}
     */
    getArray(propName) {
        return this.arrays[propName];
    }
    
    /**
     * Iterate over all active entities
     * @param {Function} callback - (index) => void
     */
    forEach(callback) {
        for (let i = 0; i < this.nextFreeIndex; i++) {
            if (this.isActive(i)) {
                callback(i);
            }
        }
    }
    
    /**
     * Compact the arrays by removing gaps (expensive, use sparingly)
     */
    compact() {
        if (this.freeList.length === 0) return;
        
        let writeIdx = 0;
        
        for (let readIdx = 0; readIdx < this.nextFreeIndex; readIdx++) {
            if (this.isActive(readIdx)) {
                if (writeIdx !== readIdx) {
                    // Copy all properties
                    for (const [propName, propDef] of Object.entries(this.schema)) {
                        const size = propDef.size || 1;
                        const arr = this.arrays[propName];
                        for (let c = 0; c < size; c++) {
                            arr[writeIdx * size + c] = arr[readIdx * size + c];
                        }
                    }
                }
                writeIdx++;
            }
        }
        
        // Reset active bits
        this.active.fill(0);
        for (let i = 0; i < writeIdx; i++) {
            const byteIdx = i >> 3;
            const bitIdx = i & 7;
            this.active[byteIdx] |= (1 << bitIdx);
        }
        
        this.nextFreeIndex = writeIdx;
        this.freeList.length = 0;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            name: this.name,
            capacity: this.capacity,
            count: this.count,
            nextFreeIndex: this.nextFreeIndex,
            freeListSize: this.freeList.length,
            fragmentation: this.freeList.length / Math.max(1, this.nextFreeIndex),
            totalBytes: this.bytesPerEntity * this.capacity,
            usedBytes: this.bytesPerEntity * this.count,
        };
    }
}

// ============================================================================
// HOST MEMORY MANAGER (Singleton Facade)
// ============================================================================

/**
 * Central manager for all host memory allocation.
 */
export class HostMemoryManager {
    constructor() {
        // Frame slab allocators
        this.slabs = new Map();
        
        // Object pools
        this.pools = new Map();
        
        // SoA containers
        this.containers = new Map();
        
        // Stats
        this.frameCount = 0;
        this.lastResetTime = 0;
        
        // Create default slabs
        this.createSlab('frame', 32 * 1024 * 1024);      // 32MB per-frame
        this.createSlab('staging', 16 * 1024 * 1024);    // 16MB GPU staging
        this.createSlab('scratch', 8 * 1024 * 1024);     // 8MB scratch space
    }
    
    /**
     * Create a new slab allocator
     * @param {string} name
     * @param {number} sizeBytes
     * @returns {SlabAllocator}
     */
    createSlab(name, sizeBytes) {
        const slab = new SlabAllocator(sizeBytes, name);
        this.slabs.set(name, slab);
        return slab;
    }
    
    /**
     * Get slab by name
     * @param {string} name
     * @returns {SlabAllocator}
     */
    getSlab(name = 'frame') {
        return this.slabs.get(name);
    }
    
    /**
     * Create a new object pool
     * @param {string} name
     * @param {Function} factory
     * @param {Function} reset
     * @param {number} capacity
     * @returns {ObjectPool}
     */
    createPool(name, factory, reset, capacity = DEFAULT_POOL_CAPACITY) {
        const pool = new ObjectPool(factory, reset, capacity, name);
        this.pools.set(name, pool);
        return pool;
    }
    
    /**
     * Get pool by name
     * @param {string} name
     * @returns {ObjectPool}
     */
    getPool(name) {
        return this.pools.get(name);
    }
    
    /**
     * Create a new SoA container
     * @param {string} name
     * @param {Object} schema
     * @param {number} capacity
     * @returns {SoAContainer}
     */
    createContainer(name, schema, capacity) {
        const container = new SoAContainer(schema, capacity, name);
        this.containers.set(name, container);
        return container;
    }
    
    /**
     * Get container by name
     * @param {string} name
     * @returns {SoAContainer}
     */
    getContainer(name) {
        return this.containers.get(name);
    }
    
    /**
     * Reset all frame allocators - call at START of each frame
     */
    beginFrame() {
        this.frameCount++;
        this.lastResetTime = performance.now();
        
        // Reset frame-based slabs
        for (const slab of this.slabs.values()) {
            slab.reset();
        }
    }
    
    /**
     * End frame processing
     */
    endFrame() {
        // Could add frame timing stats here
    }
    
    /**
     * Get comprehensive memory statistics
     * @returns {Object}
     */
    getStats() {
        const stats = {
            frameCount: this.frameCount,
            slabs: {},
            pools: {},
            containers: {},
            totalAllocated: 0,
            totalUsed: 0,
        };
        
        for (const [name, slab] of this.slabs) {
            const s = slab.getStats();
            stats.slabs[name] = s;
            stats.totalAllocated += s.totalSize;
            stats.totalUsed += s.currentUsage;
        }
        
        for (const [name, pool] of this.pools) {
            stats.pools[name] = pool.getStats();
        }
        
        for (const [name, container] of this.containers) {
            const c = container.getStats();
            stats.containers[name] = c;
            stats.totalAllocated += c.totalBytes;
            stats.totalUsed += c.usedBytes;
        }
        
        return stats;
    }
    
    /**
     * Log memory report to console
     */
    logReport() {
        const stats = this.getStats();
        console.group('[HostMemoryManager] Memory Report');
        console.log(`Frame: ${stats.frameCount}`);
        console.log(`Total Allocated: ${(stats.totalAllocated / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Total Used: ${(stats.totalUsed / 1024 / 1024).toFixed(2)} MB`);
        
        console.group('Slabs');
        for (const [name, s] of Object.entries(stats.slabs)) {
            console.log(`${name}: ${s.utilizationPercent}% (${s.allocCount} allocs, peak: ${s.peakUtilizationPercent}%)`);
        }
        console.groupEnd();
        
        console.group('Pools');
        for (const [name, p] of Object.entries(stats.pools)) {
            console.log(`${name}: ${p.inUse}/${p.capacity} (${p.utilizationPercent}%, peak: ${p.peakInUse})`);
        }
        console.groupEnd();
        
        console.group('SoA Containers');
        for (const [name, c] of Object.entries(stats.containers)) {
            console.log(`${name}: ${c.count}/${c.capacity} (frag: ${(c.fragmentation * 100).toFixed(1)}%)`);
        }
        console.groupEnd();
        
        console.groupEnd();
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const hostMemory = new HostMemoryManager();

// ============================================================================
// COMMON POOL FACTORIES
// ============================================================================

/**
 * Create common pools for game objects
 */
export function createCommonPools(manager = hostMemory) {
    // Vector3 pool
    manager.createPool('vec3',
        () => ({ x: 0, y: 0, z: 0 }),
        (v) => { v.x = 0; v.y = 0; v.z = 0; return v; },
        4096
    );
    
    // Vector4 pool
    manager.createPool('vec4',
        () => ({ x: 0, y: 0, z: 0, w: 0 }),
        (v) => { v.x = 0; v.y = 0; v.z = 0; v.w = 0; return v; },
        2048
    );
    
    // Matrix4 pool (as flat array for easier GPU upload)
    manager.createPool('mat4',
        () => new Float32Array(16),
        (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
        1024
    );
    
    // AABB pool
    manager.createPool('aabb',
        () => ({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }),
        (b) => { b.minX = b.minY = b.minZ = 0; b.maxX = b.maxY = b.maxZ = 0; return b; },
        2048
    );
    
    // Ray pool
    manager.createPool('ray',
        () => ({ ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, tMin: 0, tMax: Infinity }),
        (r) => { r.ox = r.oy = r.oz = r.dx = r.dy = 0; r.dz = 1; r.tMin = 0; r.tMax = Infinity; return r; },
        512
    );
    
    // Hit result pool
    manager.createPool('hit',
        () => ({ hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, material: 0 }),
        (h) => { h.hit = false; h.t = 0; h.x = h.y = h.z = h.nx = h.ny = h.nz = h.material = 0; return h; },
        512
    );
    
    // Command packet pool (for render commands)
    manager.createPool('renderCmd',
        () => ({
            type: 0,
            pipeline: null,
            bindGroup: null,
            vertexBuffer: null,
            indexBuffer: null,
            indexCount: 0,
            instanceCount: 1,
            firstIndex: 0,
            baseVertex: 0,
            sortKey: 0,
        }),
        (c) => {
            c.type = 0;
            c.pipeline = null;
            c.bindGroup = null;
            c.vertexBuffer = null;
            c.indexBuffer = null;
            c.indexCount = 0;
            c.instanceCount = 1;
            c.firstIndex = 0;
            c.baseVertex = 0;
            c.sortKey = 0;
            return c;
        },
        4096
    );
    
    console.log('[HostMemoryManager] Common pools created');
}

export default HostMemoryManager;
