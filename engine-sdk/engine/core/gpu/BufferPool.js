// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU Buffer Pool - Zero-allocation buffer recycling
 * Eliminates per-frame buffer creation overhead
 */

export class BufferPool {
    constructor(device, options = {}) {
        this.device = device;
        this.pools = new Map(); // size -> buffer[]
        this.inUse = new WeakMap(); // buffer -> metadata
        this.maxPoolSize = options.maxPoolSize || 64;
        this.maxPoolBytes = Math.max(0, Number(options.maxPoolBytes ?? (256 * 1024 * 1024)) || 0);
        this.pooledBytes = 0;
        this.destroyed = false;
        this.stats = {
            hits: 0,
            misses: 0,
            created: 0,
            recycled: 0,
        };
    }

    _getPoolKey(size, usage) {
        return `${size}_${usage}`;
    }

    acquire(size, usage, label = '') {
        if (this.destroyed || !this.device) throw new Error('GPU buffer pool is destroyed');
        const key = this._getPoolKey(size, usage);
        const pool = this.pools.get(key);
        
        if (pool && pool.length > 0) {
            const buffer = pool.pop();
            this.pooledBytes = Math.max(0, this.pooledBytes - Number(size));
            this.stats.hits++;
            this.inUse.set(buffer, { size, usage, label, acquiredAt: performance.now() });
            return buffer;
        }
        
        this.stats.misses++;
        this.stats.created++;
        
        const buffer = this.device.createBuffer({
            size,
            usage,
            label: label || `PooledBuffer_${key}`,
        });
        
        this.inUse.set(buffer, { size, usage, label, acquiredAt: performance.now() });
        return buffer;
    }

    release(buffer) {
        if (this.destroyed) {
            try { buffer?.destroy?.(); } catch (_) {}
            return false;
        }
        const metadata = this.inUse.get(buffer);
        if (!metadata) {
            console.warn('[BufferPool] Attempted to release non-pooled buffer');
            return false;
        }
        
        const key = this._getPoolKey(metadata.size, metadata.usage);
        let pool = this.pools.get(key);
        
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        
        if (pool.length < this.maxPoolSize && this.pooledBytes + metadata.size <= this.maxPoolBytes) {
            pool.push(buffer);
            this.pooledBytes += metadata.size;
            this.stats.recycled++;
        } else {
            buffer.destroy();
        }
        
        this.inUse.delete(buffer);
        return true;
    }

    clear() {
        for (const pool of this.pools.values()) {
            for (const buffer of pool) {
                buffer.destroy();
            }
        }
        this.pools.clear();
        this.pooledBytes = 0;
    }

    getStats() {
        const totalPooled = Array.from(this.pools.values()).reduce((sum, pool) => sum + pool.length, 0);
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
            : 0;
        
        return {
            ...this.stats,
            totalPooled,
            pooledBytes: this.pooledBytes,
            maxPoolBytes: this.maxPoolBytes,
            hitRate: `${hitRate}%`,
            destroyed: this.destroyed,
        };
    }

    destroy() {
        if (this.destroyed) return false;
        this.destroyed = true;
        this.clear();
        this.inUse = new WeakMap();
        this.device = null;
        return true;
    }
}

/**
 * Ring buffer for staging data - eliminates mapAsync stalls
 */
export class StagingBufferRing {
    constructor(device, size, count = 3) {
        this.device = device;
        this.size = size;
        this.buffers = [];
        this.currentIndex = 0;
        
        for (let i = 0; i < count; i++) {
            this.buffers.push(device.createBuffer({
                size,
                usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
                label: `StagingRing_${i}`,
            }));
        }
    }

    async getNextBuffer() {
        const buffer = this.buffers[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.buffers.length;
        
        try {
            await buffer.mapAsync(GPUMapMode.WRITE);
            return buffer;
        } catch (err) {
            console.warn('[StagingRing] mapAsync failed, creating new buffer');
            const newBuffer = this.device.createBuffer({
                size: this.size,
                usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
                label: 'StagingRing_emergency',
            });
            await newBuffer.mapAsync(GPUMapMode.WRITE);
            return newBuffer;
        }
    }

    destroy() {
        for (const buffer of this.buffers) {
            buffer.destroy();
        }
    }
}
