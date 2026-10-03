// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkStreaming.js - Async Chunk Streaming Manager
 * 
 * Manages asynchronous loading of chunks with:
 * - Budget-based streaming per frame
 * - Priority queue (visible, distance, frustum)
 * - Lock-free style ring buffer for high throughput
 * - Bucket queues for O(1) priority updates
 * - Streaming statistics
 * 
 * Based on: "Architectural Paradigms for Continuous World Streaming"
 */

// ============================================================================
// RING BUFFER - Lock-free style circular buffer for load requests
// ============================================================================

/**
 * Simple ring buffer for SPSC-like (single-producer-single-consumer) patterns
 * Main thread produces load requests, worker conceptually consumes
 */
class LoadRequestRingBuffer {
    constructor(capacity = 256) {
        this.capacity = capacity;
        this.buffer = new Array(capacity).fill(null);
        this.head = 0;  // Write position (producer)
        this.tail = 0;  // Read position (consumer)
        this.size = 0;
    }
    
    /**
     * Push a request to the buffer
     * @returns {boolean} - True if successful, false if full
     */
    push(request) {
        if (this.size >= this.capacity) {
            return false;  // Buffer full
        }
        
        this.buffer[this.head] = request;
        this.head = (this.head + 1) % this.capacity;
        this.size++;
        return true;
    }
    
    /**
     * Pop a request from the buffer
     * @returns {Object|null} - Request or null if empty
     */
    pop() {
        if (this.size === 0) {
            return null;
        }
        
        const request = this.buffer[this.tail];
        this.buffer[this.tail] = null;  // Help GC
        this.tail = (this.tail + 1) % this.capacity;
        this.size--;
        return request;
    }
    
    /**
     * Peek at the next request without removing
     */
    peek() {
        if (this.size === 0) return null;
        return this.buffer[this.tail];
    }
    
    /**
     * Check if buffer is empty
     */
    isEmpty() {
        return this.size === 0;
    }
    
    /**
     * Check if buffer is full
     */
    isFull() {
        return this.size >= this.capacity;
    }
    
    /**
     * Clear the buffer
     */
    clear() {
        this.buffer.fill(null);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }
}

// ============================================================================
// PRIORITY BUCKET QUEUE - O(1) priority updates
// ============================================================================

/**
 * Bucket-based priority queue for chunk loading
 * Chunks are placed in priority bands for fast scheduling
 */
const PRIORITY_BUCKET = {
    CRITICAL: 0,   // Must load immediately (player standing on)
    HIGH: 1,       // Very close or in view direction
    MEDIUM: 2,     // Normal loading distance
    LOW: 3,        // Far or behind player
};

class PriorityBucketQueue {
    constructor() {
        this.buckets = [
            [],  // CRITICAL
            [],  // HIGH
            [],  // MEDIUM
            [],  // LOW
        ];
        this.keyToBucket = new Map();  // key -> bucket index
        this.totalSize = 0;
    }
    
    /**
     * Calculate bucket from priority score
     */
    static bucketFromPriority(priority) {
        if (priority >= 150) return PRIORITY_BUCKET.CRITICAL;
        if (priority >= 100) return PRIORITY_BUCKET.HIGH;
        if (priority >= 50) return PRIORITY_BUCKET.MEDIUM;
        return PRIORITY_BUCKET.LOW;
    }
    
    /**
     * Enqueue a chunk load request
     */
    enqueue(key, priority, metadata = {}) {
        // Check if already queued
        if (this.keyToBucket.has(key)) {
            // Update priority if higher
            this.updatePriority(key, priority);
            return;
        }
        
        const bucketIdx = PriorityBucketQueue.bucketFromPriority(priority);
        const request = { key, priority, metadata, queueTime: performance.now() };
        
        this.buckets[bucketIdx].push(request);
        this.keyToBucket.set(key, bucketIdx);
        this.totalSize++;
    }
    
    /**
     * Update priority of an existing request (O(1) bucket move)
     */
    updatePriority(key, newPriority) {
        const oldBucket = this.keyToBucket.get(key);
        if (oldBucket === undefined) return false;
        
        const newBucket = PriorityBucketQueue.bucketFromPriority(newPriority);
        
        // Only move if bucket changed
        if (oldBucket !== newBucket) {
            // Find and remove from old bucket
            const oldQueue = this.buckets[oldBucket];
            const idx = oldQueue.findIndex(r => r.key === key);
            if (idx >= 0) {
                const [request] = oldQueue.splice(idx, 1);
                request.priority = newPriority;
                this.buckets[newBucket].push(request);
                this.keyToBucket.set(key, newBucket);
            }
        }
        return true;
    }
    
    /**
     * Dequeue highest priority request
     */
    dequeue() {
        for (let i = 0; i < this.buckets.length; i++) {
            if (this.buckets[i].length > 0) {
                const request = this.buckets[i].shift();
                this.keyToBucket.delete(request.key);
                this.totalSize--;
                return request;
            }
        }
        return null;
    }
    
    /**
     * Remove a specific key from the queue
     */
    remove(key) {
        const bucketIdx = this.keyToBucket.get(key);
        if (bucketIdx === undefined) return false;
        
        const queue = this.buckets[bucketIdx];
        const idx = queue.findIndex(r => r.key === key);
        if (idx >= 0) {
            queue.splice(idx, 1);
            this.keyToBucket.delete(key);
            this.totalSize--;
            return true;
        }
        return false;
    }
    
    /**
     * Check if key is queued
     */
    has(key) {
        return this.keyToBucket.has(key);
    }
    
    /**
     * Get total queue size
     */
    get size() {
        return this.totalSize;
    }
    
    /**
     * Clear all buckets
     */
    clear() {
        for (const bucket of this.buckets) {
            bucket.length = 0;
        }
        this.keyToBucket.clear();
        this.totalSize = 0;
    }
}

export { PRIORITY_BUCKET, PriorityBucketQueue, LoadRequestRingBuffer };

export class ChunkStreaming {
    constructor() {
        this.enabled = true;
        
        // Budget settings
        this.budgetKB = 512;
        this.prioritizeVisible = true;
        this.frustumPriority = true;
        this.viewPriorityBoost = 10;
        this.distancePriority = true;
        
        // Advanced queue management - bucket queue for O(1) priority updates
        this.priorityQueue = new PriorityBucketQueue();
        this.ringBuffer = new LoadRequestRingBuffer(256);
        this.loadQueue = [];  // Legacy fallback
        this.activeLoads = new Map();
        this.maxConcurrent = 4;
        this.useAdvancedQueue = true;
        
        // Statistics
        this.stats = {
            totalLoaded: 0,
            totalBytes: 0,
            avgLoadTimeMs: 0,
            queueLength: 0,
            activeLoads: 0,
            bucketStats: [0, 0, 0, 0],
        };
        
        // Timing
        this.frameStartTime = 0;
        this.frameBudgetUsed = 0;
    }
    
    /**
     * Begin frame - reset budget
     */
    beginFrame() {
        this.frameStartTime = performance.now();
        this.frameBudgetUsed = 0;
    }
    
    /**
     * Queue a chunk for loading
     * @param {string} key - Chunk key "x,y,z"
     * @param {number} priority - Higher = load sooner
     * @param {Object} metadata - Extra info (distance, visible, etc.)
     */
    queueLoad(key, priority = 0, metadata = {}) {
        if (this.activeLoads.has(key)) return;
        
        if (this.useAdvancedQueue) {
            // Use bucket queue for O(1) priority updates
            this.priorityQueue.enqueue(key, priority, metadata);
            return;
        }
        
        // Legacy: Check if already queued
        const existing = this.loadQueue.find(q => q.key === key);
        if (existing) {
            existing.priority = Math.max(existing.priority, priority);
            return;
        }
        
        this.loadQueue.push({
            key,
            priority,
            metadata,
            queueTime: performance.now(),
        });
        
        // Sort by priority (descending)
        this.loadQueue.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * Calculate priority for a chunk
     * @param {number} distance - Distance from camera
     * @param {boolean} inFrustum - Is in view frustum
     * @param {boolean} visible - Is potentially visible
     */
    calculatePriority(distance, inFrustum, visible) {
        let priority = 100 - distance;
        
        if (this.prioritizeVisible && visible) {
            priority += 50;
        }
        
        if (this.frustumPriority && inFrustum) {
            priority += this.viewPriorityBoost;
        }
        
        if (this.distancePriority) {
            priority += Math.max(0, 20 - distance);
        }
        
        return priority;
    }
    
    /**
     * Process streaming queue for this frame
     * @param {Function} loadFn - Function to call for each chunk: (key) => Promise<{bytes}>
     * @returns {number} - Number of chunks started loading
     */
    async processQueue(loadFn) {
        const queueSize = this.useAdvancedQueue 
            ? this.priorityQueue.size 
            : this.loadQueue.length;
            
        if (!this.enabled || queueSize === 0) return 0;
        
        let started = 0;
        const budgetBytes = this.budgetKB * 1024;
        
        while (
            (this.useAdvancedQueue ? this.priorityQueue.size > 0 : this.loadQueue.length > 0) &&
            this.activeLoads.size < this.maxConcurrent &&
            this.frameBudgetUsed < budgetBytes
        ) {
            // Dequeue from appropriate queue
            const item = this.useAdvancedQueue 
                ? this.priorityQueue.dequeue()
                : this.loadQueue.shift();
            if (!item) break;
            
            this.activeLoads.set(item.key, {
                startTime: performance.now(),
                metadata: item.metadata,
            });
            
            // Start async load
            loadFn(item.key).then(result => {
                const loadInfo = this.activeLoads.get(item.key);
                if (loadInfo) {
                    const loadTime = performance.now() - loadInfo.startTime;
                    this.stats.totalLoaded++;
                    this.stats.totalBytes += result?.bytes || 0;
                    this.stats.avgLoadTimeMs = (this.stats.avgLoadTimeMs * 0.9) + (loadTime * 0.1);
                }
                this.activeLoads.delete(item.key);
            }).catch(() => {
                this.activeLoads.delete(item.key);
            });
            
            // Estimate budget usage
            this.frameBudgetUsed += 32 * 1024; // Estimate 32KB per chunk
            started++;
        }
        
        // Update stats
        this.stats.queueLength = this.useAdvancedQueue 
            ? this.priorityQueue.size 
            : this.loadQueue.length;
        this.stats.activeLoads = this.activeLoads.size;
        
        // Bucket stats for debugging
        if (this.useAdvancedQueue) {
            for (let i = 0; i < 4; i++) {
                this.stats.bucketStats[i] = this.priorityQueue.buckets[i].length;
            }
        }
        
        return started;
    }
    
    /**
     * Cancel pending load
     * @param {string} key 
     */
    cancelLoad(key) {
        if (this.useAdvancedQueue) {
            this.priorityQueue.remove(key);
            return;
        }
        const idx = this.loadQueue.findIndex(q => q.key === key);
        if (idx >= 0) {
            this.loadQueue.splice(idx, 1);
        }
    }
    
    /**
     * Clear all pending loads
     */
    clearQueue() {
        if (this.useAdvancedQueue) {
            this.priorityQueue.clear();
            this.ringBuffer.clear();
        }
        this.loadQueue = [];
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_streaming] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.budgetKB = parseInt(cfg.budget_kb) || 512;
        this.prioritizeVisible = cfg.prioritize_visible !== false;
        this.frustumPriority = cfg.frustum_priority !== false;
        this.viewPriorityBoost = parseInt(cfg.view_priority_boost) || 10;
        this.distancePriority = cfg.distance_priority !== false;
    }
}

export default ChunkStreaming;
