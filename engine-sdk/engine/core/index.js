// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Engine Core - Unified Exports
 * 
 * High-performance resource management for WebGPU applications
 */

// Resource Manager (main facade)
export { 
    ResourceManager, 
    resources,
    JobPriority,
    hostMemory,
    scheduler,
    SlabAllocator,
    ObjectPool,
    SoAContainer,
    workerTemplate,
} from './ResourceManager.js';

// Memory management
export {
    HostMemoryManager,
    GPUMemoryManager,
    RingBuffer,
    BuddyAllocator,
    StagingBufferPool,
    BindGroupCache,
    TextureManager,
    createCommonPools,
    getGPUMemoryManager,
} from './memory/index.js';

// Task scheduling
export {
    TaskScheduler,
    Job,
    WorkerPool,
} from './scheduler/index.js';

// Frame pipeline
export {
    FramePipeline,
    createFrameContext,
} from './framepipeline/index.js';

// Frame pacing and bounded fixed-step planning
export * from './timing/index.js';

// Approved, owner-scoped asynchronous CPU/Wasm/GPU capabilities.
export * as Compute from './compute/index.js';
export { ComputeRuntime, createComputeRuntime } from './compute/index.js';
