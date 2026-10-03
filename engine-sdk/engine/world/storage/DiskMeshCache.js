// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DiskMeshCache.js - IndexedDB Mesh Caching
 * 
 * Saves meshed vertex data to browser IndexedDB for instant restoration.
 * Avoids re-meshing chunks that have been visited before.
 * 
 * Benefits:
 * - Skip meshing on revisit (instant load)
 * - Persists across sessions
 * - Reduces CPU/GPU work
 * - Great for large worlds
 * 
 * Storage format:
 * - Key: "worldSeed_chunkX_chunkY_chunkZ"
 * - Value: { vertices, indices, metadata, timestamp }
 */

const DB_NAME = 'VoxelMeshCache';
const DB_VERSION = 1;
const STORE_NAME = 'meshes';
const MAX_CACHE_SIZE_MB = 500;  // Max cache size
const MAX_CACHE_AGE_DAYS = 30;  // Max age before eviction

/**
 * DiskMeshCache - IndexedDB-backed mesh cache
 */
export class DiskMeshCache {
    constructor() {
        this.db = null;
        this.initialized = false;
        this.enabled = true;
        
        // Current world seed (for cache isolation)
        this.worldSeed = 0;
        
        // In-memory LRU cache for hot data
        this.memoryCache = new Map();
        this.maxMemoryCacheSize = 100;  // Max chunks in memory
        
        // Stats
        this.stats = {
            hits: 0,
            misses: 0,
            saves: 0,
            evictions: 0,
            totalSizeBytes: 0,
        };
        
        // Pending operations
        this.pendingSaves = new Map();
        this.saveDebounceMs = 100;
    }
    
    /**
     * Initialize the IndexedDB database
     * @param {number} worldSeed 
     */
    async init(worldSeed = 0) {
        this.worldSeed = worldSeed;
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => {
                console.error('[DiskMeshCache] Failed to open IndexedDB:', request.error);
                this.enabled = false;
                resolve(false);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                this.initialized = true;
                console.log('[DiskMeshCache] Initialized');
                
                // Clean up old entries
                this.cleanupOldEntries();
                
                resolve(true);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('worldSeed', 'worldSeed', { unique: false });
                    console.log('[DiskMeshCache] Created object store');
                }
            };
        });
    }
    
    /**
     * Generate cache key for a chunk
     * @param {number} chunkX 
     * @param {number} chunkY 
     * @param {number} chunkZ 
     * @returns {string}
     */
    getKey(chunkX, chunkY, chunkZ) {
        return `${this.worldSeed}_${chunkX}_${chunkY}_${chunkZ}`;
    }
    
    /**
     * Check if mesh exists in cache
     * @param {number} chunkX 
     * @param {number} chunkY 
     * @param {number} chunkZ 
     * @returns {Promise<boolean>}
     */
    async has(chunkX, chunkY, chunkZ) {
        const key = this.getKey(chunkX, chunkY, chunkZ);
        
        // Check memory cache first
        if (this.memoryCache.has(key)) {
            return true;
        }
        
        if (!this.initialized || !this.enabled) return false;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count(IDBKeyRange.only(key));
            
            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = () => resolve(false);
        });
    }
    
    /**
     * Get mesh from cache
     * @param {number} chunkX 
     * @param {number} chunkY 
     * @param {number} chunkZ 
     * @returns {Promise<Object|null>} - { vertices, indices, metadata }
     */
    async get(chunkX, chunkY, chunkZ) {
        const key = this.getKey(chunkX, chunkY, chunkZ);
        
        // Check memory cache first
        if (this.memoryCache.has(key)) {
            this.stats.hits++;
            const cached = this.memoryCache.get(key);
            // Move to end (LRU)
            this.memoryCache.delete(key);
            this.memoryCache.set(key, cached);
            return cached;
        }
        
        if (!this.initialized || !this.enabled) {
            this.stats.misses++;
            return null;
        }
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);
            
            request.onsuccess = () => {
                if (request.result) {
                    this.stats.hits++;
                    const data = {
                        vertices: request.result.vertices,
                        indices: request.result.indices,
                        metadata: request.result.metadata,
                    };
                    
                    // Add to memory cache
                    this.addToMemoryCache(key, data);
                    
                    resolve(data);
                } else {
                    this.stats.misses++;
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                this.stats.misses++;
                resolve(null);
            };
        });
    }
    
    /**
     * Save mesh to cache
     * @param {number} chunkX 
     * @param {number} chunkY 
     * @param {number} chunkZ 
     * @param {Float32Array|Uint8Array} vertices 
     * @param {Uint16Array|Uint32Array} indices 
     * @param {Object} metadata - Optional metadata
     */
    async save(chunkX, chunkY, chunkZ, vertices, indices, metadata = {}) {
        if (!this.initialized || !this.enabled) return;
        
        const key = this.getKey(chunkX, chunkY, chunkZ);
        
        // Debounce saves for the same chunk
        if (this.pendingSaves.has(key)) {
            clearTimeout(this.pendingSaves.get(key));
        }
        
        this.pendingSaves.set(key, setTimeout(() => {
            this.pendingSaves.delete(key);
            this.saveImmediate(key, chunkX, chunkY, chunkZ, vertices, indices, metadata);
        }, this.saveDebounceMs));
    }
    
    /**
     * Immediate save (internal)
     */
    async saveImmediate(key, chunkX, chunkY, chunkZ, vertices, indices, metadata) {
        const data = {
            key,
            worldSeed: this.worldSeed,
            chunkX,
            chunkY,
            chunkZ,
            vertices: new Uint8Array(vertices.buffer).slice(),
            indices: new Uint8Array(indices.buffer).slice(),
            vertexType: vertices.constructor.name,
            indexType: indices.constructor.name,
            metadata,
            timestamp: Date.now(),
            size: vertices.byteLength + indices.byteLength,
        };
        
        // Add to memory cache
        this.addToMemoryCache(key, {
            vertices,
            indices,
            metadata,
        });
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(data);
            
            request.onsuccess = () => {
                this.stats.saves++;
                this.stats.totalSizeBytes += data.size;
                resolve(true);
            };
            
            request.onerror = () => {
                console.warn('[DiskMeshCache] Save failed:', request.error);
                resolve(false);
            };
        });
    }
    
    /**
     * Add to memory cache with LRU eviction
     */
    addToMemoryCache(key, data) {
        // Evict oldest if at capacity
        while (this.memoryCache.size >= this.maxMemoryCacheSize) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }
        
        this.memoryCache.set(key, data);
    }
    
    /**
     * Delete mesh from cache
     * @param {number} chunkX 
     * @param {number} chunkY 
     * @param {number} chunkZ 
     */
    async delete(chunkX, chunkY, chunkZ) {
        const key = this.getKey(chunkX, chunkY, chunkZ);
        
        // Remove from memory cache
        this.memoryCache.delete(key);
        
        if (!this.initialized || !this.enabled) return;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    }
    
    /**
     * Clear all cached meshes for current world
     */
    async clearWorld() {
        this.memoryCache.clear();
        
        if (!this.initialized || !this.enabled) return;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('worldSeed');
            const request = index.openCursor(IDBKeyRange.only(this.worldSeed));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    console.log('[DiskMeshCache] Cleared world cache');
                    resolve(true);
                }
            };
            
            request.onerror = () => resolve(false);
        });
    }
    
    /**
     * Clear entire cache
     */
    async clearAll() {
        this.memoryCache.clear();
        
        if (!this.initialized || !this.enabled) return;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            
            request.onsuccess = () => {
                console.log('[DiskMeshCache] Cleared all cache');
                this.stats.totalSizeBytes = 0;
                resolve(true);
            };
            
            request.onerror = () => resolve(false);
        });
    }
    
    /**
     * Clean up old entries
     */
    async cleanupOldEntries() {
        if (!this.initialized || !this.enabled) return;
        
        const maxAge = MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - maxAge;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('timestamp');
            const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
            
            let evicted = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    evicted++;
                    cursor.continue();
                } else {
                    if (evicted > 0) {
                        console.log(`[DiskMeshCache] Evicted ${evicted} old entries`);
                        this.stats.evictions += evicted;
                    }
                    resolve(evicted);
                }
            };
            
            request.onerror = () => resolve(0);
        });
    }
    
    /**
     * Get cache statistics
     */
    async getCacheInfo() {
        if (!this.initialized || !this.enabled) {
            return { count: 0, sizeBytes: 0 };
        }
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const countRequest = store.count();
            
            countRequest.onsuccess = () => {
                resolve({
                    count: countRequest.result,
                    sizeBytes: this.stats.totalSizeBytes,
                    sizeMB: this.stats.totalSizeBytes / (1024 * 1024),
                });
            };
            
            countRequest.onerror = () => resolve({ count: 0, sizeBytes: 0 });
        });
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits / Math.max(1, this.stats.hits + this.stats.misses),
            memoryCacheSize: this.memoryCache.size,
        };
    }
    
    /**
     * Set world seed (call when changing worlds)
     * @param {number} seed 
     */
    setWorldSeed(seed) {
        this.worldSeed = seed;
        this.memoryCache.clear();  // Clear memory cache for new world
    }
    
    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.initialized = false;
        this.memoryCache.clear();
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_compression] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.disk_cache !== false;
        this.maxMemoryCacheSize = parseInt(cfg.max_memory_cache) || 100;
    }
}

export default DiskMeshCache;
