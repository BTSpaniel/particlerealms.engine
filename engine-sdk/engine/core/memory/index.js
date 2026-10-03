// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Memory Management System - Unified Exports
 * 
 * High-performance resource management for WebGPU applications:
 * - HostMemoryManager: RAM allocation (Slab + Object Pools)
 * - GPUMemoryManager: VRAM allocation (Ring Buffer + Buddy Allocator)
 */

export {
    HostMemoryManager,
    SlabAllocator,
    ObjectPool,
    SoAContainer,
    hostMemory,
    createCommonPools,
} from './HostMemoryManager.js';

export {
    GPUMemoryManager,
    RingBuffer,
    BuddyAllocator,
    StagingBufferPool,
    BindGroupCache,
    TextureManager,
    getGPUMemoryManager,
} from './GPUMemoryManager.js';
