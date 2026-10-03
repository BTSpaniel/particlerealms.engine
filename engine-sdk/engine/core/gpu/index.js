// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/core/gpu/index.js - GPU Utilities Barrel Export
 */

// Random number generation
export {
    GPU_RANDOM_WGSL,
    pcgHash,
    hash2D,
    hash3D,
    initRngState,
    PCGRandom,
    accumulationWeight,
    accumulateColor,
    accumulateEMA,
    wavelengthToRGB,
    spectralHeatMap,
    countToSpectral,
    blueNoiseOffset,
    r2Sequence3D,
    halton,
    halton2D,
    halton3D,
    TAA_JITTER_WGSL,
    STRATIFIED_SAMPLE_WGSL,
    DeterministicRNG,
    MULTIPLAYER_RANDOM_WGSL,
} from './GPURandom.js';

// Profiling
export { GPUProfiler } from './GPUProfiler.js';
export { GPUTimestampProfiler } from './GPUTimestampProfiler.js';
export {
    SimulationProfiler,
    createSimulationProfiler,
    profiledComputePass,
    ProfileSections,
} from './SimulationProfiler.js';
export { GpuRenderWorkerHost } from './GpuRenderWorkerHost.js';
export {
    AdaptiveQualityGovernor,
    ADAPTIVE_QUALITY_TIERS,
    createAdaptiveQualityGovernor,
} from './AdaptiveQualityGovernor.js';
export { planProgressiveWorkBudget } from './ProgressiveWorkBudget.js';
export { SparsePageRuntime, createSparsePageRuntime } from './SparsePageRuntime.js';

// Memory allocation
export { GPUPageAllocator, GPU_PAGE_WGSL } from './GPUPageAllocator.js';

// Sorting
export {
    SortKeyType,
    MAX_ELEMENTS as SORT_MAX_ELEMENTS,
    positionToMorton,
    BitonicSorter,
    bitonicSortCPU,
    RadixSorter,
} from './BitonicSort.js';

// Caller-encoded, bounded data primitives
export {
    GPU_EXCLUSIVE_U32_SCAN_WGSL,
    GpuExclusiveU32Scan,
} from './GpuExclusiveScan.js';
export {
    GPU_STABLE_U32_RADIX_SORT_WGSL,
    GpuStableU32RadixSort,
} from './GpuStableRadixSort.js';
export {
    GPU_STABLE_FLAG_COMPACTION_WGSL,
    GpuStableFlagCompaction,
} from './GpuStableCompaction.js';
export {
    GPU_SEGMENTED_VEC4_REDUCTION_WGSL,
    GpuSegmentedVec4Reduction,
} from './GpuSegmentedReduction.js';
export {
    GPU_BOUNDED_FRONTIER_QUEUE_WGSL,
    GPU_BOUNDED_FRONTIER_RESET_WGSL,
    GPU_FRONTIER_INDIRECT_OFFSET,
    GPU_FRONTIER_METADATA_BYTES,
    GPU_FRONTIER_METADATA_WORDS,
    GPU_FRONTIER_STATUS_EMPTY,
    GPU_FRONTIER_STATUS_OVERFLOW,
    GPU_FRONTIER_STATUS_SATURATED,
    GpuBoundedU32FrontierQueue,
} from './GpuBoundedFrontierQueue.js';

// Buffer layouts
export {
    UNIFORM_ALIGN,
    STORAGE_ALIGN,
    INDIRECT_ALIGN,
    FIXED_SCALE,
    FIXED_SCALE_INV,
    toFixed,
    fromFixed,
    alignTo,
    paddingFor,
    isAligned,
    TYPE_SIZES,
    PARTICLE_LAYOUT,
    GRID_CELL_LAYOUT,
    GRID_VELOCITY_LAYOUT,
    FDTD_CELL_LAYOUT,
    DIRTY_CHUNK_LAYOUT,
    DIRTY_FLAGS,
    getParticleBufferSizes,
    getGridBufferSizes,
    createAlignedBuffer,
    createBufferWithData,
    WGSL_FIXED_POINT,
    WGSL_GRID_INDEX,
} from './BufferLayouts.js';

// WGSL utilities
export { calcWGSLStructSize, getFloat32ArraySize, createUniformBuffer } from './WGSLStructSize.js';
export { DynamicUniformBuffer } from './DynamicUniformBuffer.js';

export {
    ResourceSignal,
    createSignal,
    BindGroupSignals,
    generateWGSLBindGroupDeclarations,
} from './BindingSignals.js';

export { createGpuPassGraph } from './GpuPassGraph.js';

// Indirect dispatch
export {
    GENERATOR_WORKGROUP_SIZE,
    MAX_JOBS,
    INDIRECT_BUFFER_SIZE,
    IndirectDispatchGen,
    MultiPassDispatchGen,
} from './IndirectDispatchGen.js';

// Async compute
export { AsyncComputeScheduler } from './AsyncComputeScheduler.js';
export { AsyncGPUWorkScheduler, GPUFrameCoordinator, GPUWorkFence } from './AsyncGPUWorkScheduler.js';

// Existing GPU utilities
export * as GpuDevice from './GpuDevice.js';
export { GpuFrameBudgetBroker } from './GpuFrameBudgetBroker.js';
export * as GpuBuffer from './GpuBuffer.js';
export * as GpuTexture from './GpuTexture.js';
export * as GpuTextureLoader from './GpuTextureLoader.js';
export * as GpuSampler from './GpuSampler.js';
export * as GpuCanvas from './GpuCanvas.js';
export * as GpuInit from './GpuInit.js';
export * as GpuDebug from './GpuDebug.js';
export * as GpuFormats from './GpuFormats.js';
export * as GpuMetrics from './GpuMetrics.js';
export * as GpuTransfer from './GpuTransfer.js';
export * as WebGpuCanvasBootstrap from './WebGpuCanvasBootstrap.js';

// Virtual GPU Driver - unified abstraction layer
export {
  VirtualGPU,
    acquireVGPU,
    createVGPURecoveryParticipant,
    getVGPU,
    getVGPURegistryInfo,
    initVGPU,
    invalidateVGPU,
  vgpu,
} from './VirtualGPU.js';
export {
  GPU_DEVICE_OWNERSHIP_POLICIES,
  acquireGpuDeviceForConsumer,
  normalizeGpuDeviceOwnership,
} from './GpuDeviceOwnership.js';
export {
  GpuShaderDiagnosticRegistry,
  assertCheckedShaderModule,
  createCheckedShaderModule,
  getCheckedShaderCompilation,
  getGpuShaderDiagnosticRegistry,
} from './GpuShaderDiagnostics.js';

// Advanced rendering modules
export { VGPURenderGraph, RenderGraphBuilder, ResourceUsage, ResourceType } from './VGPURenderGraph.js';
export { VGPUIndirectRenderer, IndirectInstanceBuilder } from './VGPUIndirectRenderer.js';
export { VGPUHiZCulling, BoundingBoxBuilder } from './VGPUHiZCulling.js';
export { VGPUStreamingManager, ResourceState, StreamingResourceType } from './VGPUStreamingManager.js';
export { VGPUDebugDraw, DebugDrawScope } from './VGPUDebugDraw.js';
