// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MappedBufferRing.js - Zero-Copy Buffer Updates
 * 
 * Provides a ring of pre-mapped buffers to avoid copies when uploading data to GPU.
 * 
 * Standard writeBuffer() flow:
 *   JS TypedArray → Copy → C++ → Copy → GPU Process → Copy → GPU Buffer
 * 
 * MappedBufferRing flow:
 *   JS writes directly to mapped memory → GPU Process → Copy → GPU Buffer
 *   (Saves one copy!)
 * 
 * Based on: https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
 */

/**
 * MappedBufferRing - Efficient GPU data upload with pre-mapped buffers
 */
export class MappedBufferRing {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Ring of mapped buffers by size class
        // Key: size bucket, Value: array of available mapped buffers
        this.availableBuffers = new Map();
        
        // Buffers currently in use (waiting for GPU)
        this.inFlightBuffers = [];
        
        // Size buckets (powers of 2)
        this.sizeBuckets = [
            256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
            65536, 131072, 262144, 524288, 1048576
        ];
        
        // Configuration
        this.maxBuffersPerBucket = 8;
        this.reclaimDelayMs = 0;  // Reclaim immediately when mapped
        
        // Statistics
        this.stats = {
            allocations: 0,
            reuses: 0,
            copiesSaved: 0,
            totalBytesTransferred: 0,
        };
    }
    
    /**
     * Initialize the buffer ring
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        
        // Pre-allocate some buffers for common sizes
        for (const size of [4096, 16384, 65536]) {
            this.availableBuffers.set(size, []);
            // Pre-create 2 buffers per common size
            for (let i = 0; i < 2; i++) {
                const buffer = this.createMappedBuffer(size);
                this.availableBuffers.get(size).push(buffer);
            }
        }
        
        this.initialized = true;
        console.log('[MappedBufferRing] Initialized with pre-allocated buffers');
    }
    
    /**
     * Get the size bucket for a given size
     * @param {number} size 
     * @returns {number}
     */
    getSizeBucket(size) {
        for (const bucket of this.sizeBuckets) {
            if (size <= bucket) return bucket;
        }
        // Larger than max bucket - round up to next power of 2
        return Math.pow(2, Math.ceil(Math.log2(size)));
    }
    
    /**
     * Create a new mapped buffer
     * @param {number} size 
     * @returns {GPUBuffer}
     */
    createMappedBuffer(size) {
        return this.device.createBuffer({
            label: `MappedRing ${size}`,
            size,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
    }
    
    /**
     * Get a mapped buffer of at least the requested size
     * @param {number} size - Minimum size needed
     * @returns {{buffer: GPUBuffer, mappedRange: ArrayBuffer, actualSize: number}}
     */
    acquire(size) {
        if (!this.initialized) {
            throw new Error('MappedBufferRing not initialized');
        }
        
        const bucket = this.getSizeBucket(size);
        
        // Try to get an available buffer from the pool
        let buffers = this.availableBuffers.get(bucket);
        if (!buffers) {
            buffers = [];
            this.availableBuffers.set(bucket, buffers);
        }
        
        let buffer;
        if (buffers.length > 0) {
            buffer = buffers.pop();
            this.stats.reuses++;
        } else {
            buffer = this.createMappedBuffer(bucket);
            this.stats.allocations++;
        }
        
        return {
            buffer,
            mappedRange: buffer.getMappedRange(),
            actualSize: bucket,
        };
    }
    
    /**
     * Write data and copy to target buffer
     * @param {GPUCommandEncoder} encoder - Command encoder for the copy
     * @param {GPUBuffer} targetBuffer - Destination buffer
     * @param {number} targetOffset - Offset in target buffer
     * @param {ArrayBuffer|TypedArray} data - Data to write
     * @returns {number} - Bytes written
     */
    writeAndCopy(encoder, targetBuffer, targetOffset, data) {
        const dataView = data instanceof ArrayBuffer ? 
            new Uint8Array(data) : 
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        
        const size = dataView.byteLength;
        const { buffer, mappedRange } = this.acquire(size);
        
        // Write directly to mapped memory (no copy to intermediate buffer!)
        new Uint8Array(mappedRange).set(dataView);
        
        // Unmap before copy
        buffer.unmap();
        
        // Encode copy command
        encoder.copyBufferToBuffer(buffer, 0, targetBuffer, targetOffset, size);
        
        // Schedule buffer for reclamation
        this.scheduleReclaim(buffer, this.getSizeBucket(size));
        
        this.stats.copiesSaved++;
        this.stats.totalBytesTransferred += size;
        
        return size;
    }
    
    /**
     * Write uniform data efficiently
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUBuffer} uniformBuffer 
     * @param {number} offset 
     * @param {Float32Array|Uint32Array} data 
     */
    writeUniform(encoder, uniformBuffer, offset, data) {
        return this.writeAndCopy(encoder, uniformBuffer, offset, data);
    }
    
    /**
     * Schedule a buffer to be reclaimed after GPU is done
     * @param {GPUBuffer} buffer 
     * @param {number} bucket 
     */
    scheduleReclaim(buffer, bucket) {
        const doMap = () => {
            buffer.mapAsync(GPUMapMode.WRITE).then(() => {
                const buffers = this.availableBuffers.get(bucket);
                if (buffers && buffers.length < this.maxBuffersPerBucket) {
                    buffers.push(buffer);
                } else {
                    buffer.destroy();
                }
            }).catch(() => {
            });
        };

        if (typeof queueMicrotask === 'function') {
            queueMicrotask(doMap);
        } else {
            Promise.resolve().then(doMap);
        }
    }
    
    /**
     * Get statistics
     */
    getStats() {
        let totalAvailable = 0;
        for (const buffers of this.availableBuffers.values()) {
            totalAvailable += buffers.length;
        }
        
        return {
            ...this.stats,
            availableBuffers: totalAvailable,
            bucketCount: this.availableBuffers.size,
        };
    }
    
    /**
     * Destroy all buffers
     */
    destroy() {
        for (const buffers of this.availableBuffers.values()) {
            for (const buffer of buffers) {
                try {
                    buffer.unmap();
                } catch (e) { /* Already unmapped */ }
                buffer.destroy();
            }
        }
        this.availableBuffers.clear();
        this.initialized = false;
    }
}

export default MappedBufferRing;
