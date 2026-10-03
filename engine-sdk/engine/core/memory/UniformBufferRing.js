// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UniformBufferRing.js - Double/Triple Buffered Uniforms
 * 
 * Prevents GPU stalls by rotating uniform buffers each frame.
 * While GPU reads from one buffer, CPU writes to another.
 * 
 * Benefits:
 * - No stalls waiting for GPU to finish reading uniforms
 * - Better frame pacing
 * - Smoother performance
 * 
 * Usage:
 *   const ring = new UniformBufferRing();
 *   ring.init(device, uniformSize, 3); // Triple buffering
 *   
 *   // Each frame:
 *   const buffer = ring.getWriteBuffer();
 *   device.queue.writeBuffer(buffer, 0, uniformData);
 *   const bindGroup = ring.getBindGroup(layout, bindings);
 */

/**
 * UniformBufferRing - Rotating uniform buffers
 */
export class UniformBufferRing {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Buffer ring
        this.buffers = [];
        this.bindGroups = [];
        this.currentIndex = 0;
        this.bufferCount = 2;  // Default: double buffering
        
        // Configuration
        this.bufferSize = 0;
        this.label = 'UniformRing';
    }
    
    /**
     * Initialize the buffer ring
     * @param {GPUDevice} device 
     * @param {number} size - Size of each buffer in bytes
     * @param {number} count - Number of buffers (2 = double, 3 = triple)
     * @param {string} label - Label for debugging
     */
    init(device, size, count = 2, label = 'UniformRing') {
        this.device = device;
        this.bufferSize = size;
        this.bufferCount = count;
        this.label = label;
        
        // Create buffers
        for (let i = 0; i < count; i++) {
            const buffer = device.createBuffer({
                label: `${label} Buffer ${i}`,
                size,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.buffers.push(buffer);
        }
        
        this.initialized = true;
    }
    
    /**
     * Get the buffer to write to this frame
     * @returns {GPUBuffer}
     */
    getWriteBuffer() {
        return this.buffers[this.currentIndex];
    }
    
    /**
     * Get the current buffer index
     * @returns {number}
     */
    getCurrentIndex() {
        return this.currentIndex;
    }
    
    /**
     * Advance to the next buffer (call at end of frame)
     */
    advance() {
        this.currentIndex = (this.currentIndex + 1) % this.bufferCount;
    }
    
    /**
     * Write data to the current buffer
     * @param {ArrayBuffer|TypedArray} data 
     * @param {number} offset 
     */
    write(data, offset = 0) {
        this.device.queue.writeBuffer(this.getWriteBuffer(), offset, data);
    }
    
    /**
     * Create or get a bind group for the current buffer
     * @param {GPUBindGroupLayout} layout 
     * @param {Array} additionalEntries - Additional bind group entries
     * @param {number} binding - Binding index for this buffer
     * @returns {GPUBindGroup}
     */
    createBindGroup(layout, additionalEntries = [], binding = 0) {
        const buffer = this.getWriteBuffer();
        
        const entries = [
            {
                binding,
                resource: { buffer },
            },
            ...additionalEntries,
        ];
        
        return this.device.createBindGroup({
            label: `${this.label} BindGroup ${this.currentIndex}`,
            layout,
            entries,
        });
    }
    
    /**
     * Get buffer at specific index
     * @param {number} index 
     * @returns {GPUBuffer}
     */
    getBuffer(index) {
        return this.buffers[index % this.bufferCount];
    }
    
    /**
     * Get all buffers
     * @returns {Array<GPUBuffer>}
     */
    getAllBuffers() {
        return [...this.buffers];
    }
    
    /**
     * Destroy all buffers
     */
    destroy() {
        for (const buffer of this.buffers) {
            buffer.destroy();
        }
        this.buffers = [];
        this.bindGroups = [];
        this.initialized = false;
    }
}

/**
 * FrameUniformManager - Manages per-frame uniforms with automatic rotation
 */
export class FrameUniformManager {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Uniform rings by name
        this.rings = new Map();
        
        // Current frame
        this.frameIndex = 0;
    }
    
    /**
     * Initialize the manager
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        this.initialized = true;
    }
    
    /**
     * Create a new uniform ring
     * @param {string} name 
     * @param {number} size 
     * @param {number} bufferCount 
     */
    createRing(name, size, bufferCount = 2) {
        if (this.rings.has(name)) {
            console.warn(`[FrameUniformManager] Ring ${name} already exists`);
            return this.rings.get(name);
        }
        
        const ring = new UniformBufferRing();
        ring.init(this.device, size, bufferCount, name);
        this.rings.set(name, ring);
        
        return ring;
    }
    
    /**
     * Get a ring by name
     * @param {string} name 
     * @returns {UniformBufferRing|null}
     */
    getRing(name) {
        return this.rings.get(name) || null;
    }
    
    /**
     * Write to a ring's current buffer
     * @param {string} name 
     * @param {ArrayBuffer|TypedArray} data 
     * @param {number} offset 
     */
    write(name, data, offset = 0) {
        const ring = this.rings.get(name);
        if (ring) {
            ring.write(data, offset);
        }
    }
    
    /**
     * Get the write buffer for a ring
     * @param {string} name 
     * @returns {GPUBuffer|null}
     */
    getBuffer(name) {
        const ring = this.rings.get(name);
        return ring ? ring.getWriteBuffer() : null;
    }
    
    /**
     * Advance all rings to next buffer (call at end of frame)
     */
    advanceFrame() {
        this.frameIndex++;
        for (const ring of this.rings.values()) {
            ring.advance();
        }
    }
    
    /**
     * Get frame index
     * @returns {number}
     */
    getFrameIndex() {
        return this.frameIndex;
    }
    
    /**
     * Destroy all rings
     */
    destroy() {
        for (const ring of this.rings.values()) {
            ring.destroy();
        }
        this.rings.clear();
        this.initialized = false;
    }
}

export default UniformBufferRing;
