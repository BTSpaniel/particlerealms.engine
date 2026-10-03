// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ObjectPool.js - Zero-allocation object pooling for GC reduction
 * 
 * Pools commonly allocated objects during chunk processing:
 * - Vec3/Vec4 temporary vectors
 * - Chunk info objects
 * - Ray hit results
 * - TypedArray views
 */

/**
 * Generic object pool with factory function
 */
export class ObjectPool {
    constructor(factory, reset, initialSize = 64) {
        this.factory = factory;
        this.reset = reset;
        this.pool = [];
        this.activeCount = 0;
        
        // Pre-allocate
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(factory());
        }
    }
    
    acquire() {
        this.activeCount++;
        if (this.pool.length > 0) {
            return this.pool.pop();
        }
        return this.factory();
    }
    
    release(obj) {
        this.activeCount--;
        this.reset(obj);
        this.pool.push(obj);
    }
    
    releaseAll(objects) {
        for (const obj of objects) {
            this.release(obj);
        }
    }
    
    get available() { return this.pool.length; }
    get active() { return this.activeCount; }
}

/**
 * Specialized Vec3 pool - extremely common allocation
 */
class Vec3Pool {
    constructor(initialSize = 256) {
        this.pool = [];
        this.activeCount = 0;
        
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(new Float32Array(3));
        }
    }
    
    acquire(x = 0, y = 0, z = 0) {
        this.activeCount++;
        let v;
        if (this.pool.length > 0) {
            v = this.pool.pop();
        } else {
            v = new Float32Array(3);
        }
        v[0] = x; v[1] = y; v[2] = z;
        return v;
    }
    
    release(v) {
        this.activeCount--;
        this.pool.push(v);
    }
}

/**
 * Specialized chunk info pool
 */
class ChunkInfoPool {
    constructor(initialSize = 128) {
        this.pool = [];
        this.activeCount = 0;
        
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this._create());
        }
    }
    
    _create() {
        return {
            cx: 0, cy: 0, cz: 0,
            hits: 0,
            lastSeen: 0,
            distance: 0,
            priority: 0,
            inLoadQueue: false,
            key: '',
        };
    }
    
    acquire(cx, cy, cz) {
        this.activeCount++;
        let info;
        if (this.pool.length > 0) {
            info = this.pool.pop();
        } else {
            info = this._create();
        }
        info.cx = cx;
        info.cy = cy;
        info.cz = cz;
        info.hits = 0;
        info.lastSeen = 0;
        info.distance = Infinity;
        info.priority = 0;
        info.inLoadQueue = false;
        info.key = `${cx},${cy},${cz}`;
        return info;
    }
    
    release(info) {
        this.activeCount--;
        this.pool.push(info);
    }
}

/**
 * Ray result pool for porcupine raycasting
 */
class RayResultPool {
    constructor(initialSize = 64) {
        this.pool = [];
        this.activeCount = 0;
        
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this._create());
        }
    }
    
    _create() {
        return {
            hit: false,
            cx: 0, cy: 0, cz: 0,
            distance: 0,
            hitAxis: -1,
            bounceCount: 0,
        };
    }
    
    acquire() {
        this.activeCount++;
        let result;
        if (this.pool.length > 0) {
            result = this.pool.pop();
        } else {
            result = this._create();
        }
        result.hit = false;
        result.distance = 0;
        result.hitAxis = -1;
        result.bounceCount = 0;
        return result;
    }
    
    release(result) {
        this.activeCount--;
        this.pool.push(result);
    }
}

/**
 * TypedArray pool for temporary buffers
 */
class TypedArrayPool {
    constructor() {
        this.pools = new Map(); // size -> array of buffers
    }
    
    acquireFloat32(length) {
        const key = `f32_${length}`;
        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        
        if (pool.length > 0) {
            const arr = pool.pop();
            arr.fill(0);
            return arr;
        }
        return new Float32Array(length);
    }
    
    acquireUint32(length) {
        const key = `u32_${length}`;
        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        
        if (pool.length > 0) {
            const arr = pool.pop();
            arr.fill(0);
            return arr;
        }
        return new Uint32Array(length);
    }
    
    acquireUint8(length) {
        const key = `u8_${length}`;
        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        
        if (pool.length > 0) {
            const arr = pool.pop();
            arr.fill(0);
            return arr;
        }
        return new Uint8Array(length);
    }
    
    release(arr) {
        const type = arr instanceof Float32Array ? 'f32' :
                     arr instanceof Uint32Array ? 'u32' :
                     arr instanceof Uint8Array ? 'u8' : null;
        if (!type) return;
        
        const key = `${type}_${arr.length}`;
        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        pool.push(arr);
    }
}

// Global pool instances
export const vec3Pool = new Vec3Pool(256);
export const chunkInfoPool = new ChunkInfoPool(256);
export const rayResultPool = new RayResultPool(128);
export const typedArrayPool = new TypedArrayPool();

// Convenience functions
export function acquireVec3(x = 0, y = 0, z = 0) {
    return vec3Pool.acquire(x, y, z);
}

export function releaseVec3(v) {
    vec3Pool.release(v);
}

export function acquireChunkInfo(cx, cy, cz) {
    return chunkInfoPool.acquire(cx, cy, cz);
}

export function releaseChunkInfo(info) {
    chunkInfoPool.release(info);
}

export function acquireRayResult() {
    return rayResultPool.acquire();
}

export function releaseRayResult(result) {
    rayResultPool.release(result);
}

// Stats for debugging
export function getPoolStats() {
    return {
        vec3: { available: vec3Pool.pool.length, active: vec3Pool.activeCount },
        chunkInfo: { available: chunkInfoPool.pool.length, active: chunkInfoPool.activeCount },
        rayResult: { available: rayResultPool.pool.length, active: rayResultPool.activeCount },
    };
}
