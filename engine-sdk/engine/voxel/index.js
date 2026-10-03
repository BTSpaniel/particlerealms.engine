// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/voxel/index.js - Voxel System Barrel Export
 * 
 * Core voxel functionality. Other systems have been moved to:
 * - engine/render/passes/ - Post-processing passes
 * - engine/render/atmosphere/ - Sky and atmospheric rendering
 * - engine/world/ - World generation, streaming, storage, time
 * - engine/sim/physics/ - Physics systems
 * - engine/sim/fluids/ - Fluid simulation
 * - engine/core/gpu/ - GPU utilities
 * - engine/core/math/ - Math utilities
 * - engine/core/memory/ - Memory management
 * - engine/core/profiler/ - Profiling
 * - engine/game/ - Gameplay systems
 */

// ============================================================================
// CORE VOXEL SYSTEMS (local files)
// ============================================================================

// Material System
export {
    SCHEMA_VERSION,
    MATERIAL_DEFINITIONS,
    MATERIAL,
    MATERIAL_COLORS,
    MATERIAL_COLORS_NORMALIZED,
    MATERIAL_PROPERTIES,
    MATERIAL_NAMES,
    MATERIAL_IDS,
    MATERIAL_COUNT,
    getMaterialId,
    getMaterialName,
    getMaterialColor,
    getMaterialProperties,
    isTransparent,
    isSolid,
    isFluid,
    isEmissive,
    validateSchema,
} from './MaterialSchema.js';

// Voxel Constants
export {
    CHUNK_SIZE,
    CHUNK_SIZE_SQ,
    CHUNK_VOLUME,
    DEPTH_TIERS,
    getDepthTier,
    getDepthTierBlend,
    FACE_NORMALS,
    FACE_NAMES,
} from './VoxelConstants.js';

// Voxel Meshing
export {
    meshChunk,
    meshChunkGreedy,
    meshChunkLOD,
    meshSubChunk,
    getMeshGranularity,
    createChunkBuffers,
    isTransparentMaterial,
    VERTEX_STRIDE,
    isChunkFaceSolid,
    getChunkOcclusionMask,
    getViewCullingMask,
    initGPUSubChunkMeshing,
    hasGPUSubChunkMeshing,
    meshSubChunk4GPU,
    meshSubChunk8GPU,
    releaseGPUSubChunkMesh,
    returnGPUBuffers,
    getGPUSubChunkStats,
    gpuBufferPool,
} from './VoxelMesher.js';
export { default as VoxelMesher } from './VoxelMesher.js';
export { meshChunkGreedy as greedyMesh } from './VoxelMesher.js';

export { FaceListMesher, GPUBufferPool, FACE_PULL_SHADER_BASE } from './FaceListMesher.js';
export { MarchingCubesMesher, meshChunkSmooth, MESH_MODE, smin, fbm3D, sdfTerrain, sdfSphere, sdfBox, sdfUnion, sdfSmoothUnion, sdfSubtract, sdfIntersect, generateTransitionCell, needsTransitionCell, getTransitionRatio, TRIPLANAR_SHADER, MATERIAL_BLEND_SHADER, dualContourVertex, dualContourCell, SDF_RAYMARCH_SHADER, calculateWorldSpaceAO, calculateGradientAO } from './MarchingCubesMesher.js';
export { SubChunkMeshCompute } from './SubChunkMeshCompute.js';

// MC33 Tables
export {
    MC33_CASE,
    MC33_SUBCASE_COUNT,
    CUBE_FACES,
    AMBIGUOUS_FACES,
    MC33_TRI_TABLE,
    SUBCASE_LOOKUP,
    CANONICAL_ROTATION,
    asymptoticDecider,
    isFaceAmbiguous,
    getAmbiguousFaces,
    interiorTest,
    getMC33Subcase,
    generateWGSLTables,
    rotateEdges,
} from './MC33Tables.js';

// Voxel Rendering
export { VoxelRenderer } from './VoxelRenderer.js';
export { VoxelMeshCompute } from './VoxelMeshCompute.js';
export { VoxelModifyCompute } from './VoxelModifyCompute.js';

// Voxel Ambient Occlusion
export {
    calculateVertexAO,
    calculateFaceAO,
    packAO,
    unpackAO,
    shouldFlipQuad,
    VOXEL_AO_WGSL,
    VoxelAOCalculator,
} from './VoxelAO.js';

// Voxel Raycast
export {
    raycastVoxels,
    hasVoxelLineOfSight,
    pickBlock,
    traceVoxelPath,
    VoxelRaycastGPU,
    createVoxelGetter,
    hasLineOfSightCombined,
    computePixelToRayMatrix,
    screenPixelToRay,
    RAYCAST_DEBUG_MODE,
    raycastVoxelsDebug,
    stepsToHeatColor,
    triangleVoxelIntersect,
    voxelizeMesh,
    VOXEL_RAYCAST_SHADER,
    MAX_RAY_DISTANCE,
} from './VoxelRaycast.js';

// Colored Lighting
export {
    packLight,
    unpackLight,
    getChannel,
    lightMax,
    lightDecrement,
    hasLight,
    lightToRGB,
    ColoredLightingSystem,
} from './ColoredLighting.js';

// Texture Management
export { TextureArrayManager } from './TextureArrayManager.js';

// Chunk Systems (core voxel-specific)
export {
    ChunkStatus,
    xxHash32,
    hashVoxels,
    BloomFilter,
    encodeMorton3D,
    decodeMorton3D,
    appendTrailer,
    verifyTrailer,
    ChunkRegistry,
    getChunkRegistry,
    initChunkRegistry,
} from './ChunkRegistry.js';
export { ChunkSorter, getCameraForward, getCameraPosition } from './ChunkSorter.js';
export { ChunkCullCompute } from './ChunkCullCompute.js';
export { NEIGHBOR_DIR, ChunkNeighborCache, NeighborCacheManager } from './NeighborCache.js';
export {
    MAX_DIRTY_PER_FRAME,
    ChunkState,
    DirtyChunkEntry,
    DirtyChunkManager,
    GeometryDirtyTracker,
    LightingDirtyTracker,
    makeChunkKey,
} from './DirtyChunkManager.js';

export {
    VoxelSdfBrickBridge,
    buildVoxelSdfBrickPair,
    createVoxelSdfBrickBridge,
    voxelSdfPageToNexel,
} from './VoxelSdfBrickBridge.js';

// ============================================================================
// RE-EXPORTS FROM NEW LOCATIONS (backward compatibility)
// ============================================================================

// Render passes
export {
    TAAPass,
    SSRPass,
    SSAOPass,
    SSGIPass,
    BloomPass,
    FXAAPass,
    HiZPass,
    DepthOfFieldPass,
    FilmGrainPass,
    ColorGradingPass,
    ChromaticAberrationPass,
    ContactShadowsPass,
    AutoExposurePass,
    AreaResamplePass,
    UnderwaterPass,
    PurkinjeEffectPass,
    PaniniProjectionPass,
    VignettePass,
    MotionBlurPass,
    LensFlarePass,
    OutlinePass,
    SharpeningPass,
    GodRays,
    GOD_RAYS_WGSL,
    VolumetricCloudsPass,
    HDRPipeline,
    HDR_PIPELINE_WGSL,
    TONEMAP_OPERATOR,
    CascadedShadowMap,
    CascadedShadowMap as CascadedShadowMapper,
    CascadeMetrics,
} from '../render/passes/index.js';

// Atmosphere
export {
    ProceduralSky,
    SUN_PHASE,
    PROCEDURAL_SKY_WGSL,
} from '../render/atmosphere/ProceduralSky.js';
export { FOG_TYPE, FOG_WGSL, DistanceFog as DistanceFogSystem } from '../render/atmosphere/DistanceFog.js';
export { AERIAL_PERSPECTIVE_WGSL, AerialPerspective as AerialPerspectiveSystem } from '../render/atmosphere/AerialPerspective.js';
export { ATMOSPHERIC_SCATTERING_WGSL, AtmosphericScattering as AtmosphericScatteringSystem } from '../render/atmosphere/AtmosphericScattering.js';
export { PLANET_CURVATURE_WGSL, PlanetCurvature as PlanetCurvatureSystem } from '../render/atmosphere/PlanetCurvature.js';
export { Sun, SunDefaults, SunWGSL } from '../render/atmosphere/CelestialSun.js';
export { Moon, MoonSystem, MoonType, MoonDefaults, MoonPresets, MoonWGSL } from '../render/atmosphere/CelestialMoon.js';
export { StarField, StarSystem, StarLayer, StarDefaults, StarLayerPresets, Constellations, StarsWGSL } from '../render/atmosphere/CelestialStars.js';
export { SpaceWGSL } from '../render/atmosphere/Space.js';
export { CelestialBodiesWGSL } from '../render/atmosphere/sky/index.js';

// Renderers
export { DualModeRenderer } from '../render/DualModeRenderer.js';
export { MinimapRenderer } from '../render/MinimapRenderer.js';
export { World3DPreviewRenderer } from '../render/World3DPreviewRenderer.js';
export { WorldParticleRenderer } from '../render/WorldParticleRenderer.js';
export { PlanetPreviewRenderer } from '../render/PlanetPreviewRenderer.js';
export { DEFAULT_PARAMS as VOLUMETRIC_PARAMS, RenderMode as VolumetricRenderMode, VolumetricRaymarcher } from '../render/VolumetricRaymarch.js';

// World systems
export * from '../world/index.js';

// World generation
export { WorldGenerator, BIOME } from '../world/generation/WorldGenerator.js';
export { GPUWorldGenerator } from '../world/generation/GPUWorldGenerator.js';
export { ProceduralTreeGenerator } from '../world/generation/ProceduralTreeGenerator.js';
export { WorldMapGenerator } from '../world/generation/WorldMapGenerator.js';
export { LayerMap } from '../world/generation/LayerMap.js';
export { UnifiedTerrainPipeline } from '../world/generation/UnifiedTerrainPipeline.js';
export { VoronoiTextureBlend } from '../world/generation/VoronoiTextureBlend.js';
export { HydraulicErosion } from '../world/generation/HydraulicErosion.js';
export { ThermalErosion } from '../world/generation/ThermalErosion.js';
export { WindErosion } from '../world/generation/WindErosion.js';
export { TectonicSimulation } from '../world/generation/TectonicSimulation.js';

// World streaming
export { ChunkStreaming, ChunkStreaming as ChunkStreamer, PRIORITY_BUCKET, PriorityBucketQueue, LoadRequestRingBuffer } from '../world/streaming/ChunkStreaming.js';
export { ChunkStreamingCompute } from '../world/streaming/ChunkStreamingCompute.js';
export { JOB_STATE, JOB_SOURCE, ChunkJobCoordinator } from '../world/streaming/ChunkJobCoordinator.js';
export { LOAD_PATTERN, PriorityChunkLoader } from '../world/streaming/PriorityChunkLoader.js';
export { ProgressiveChunkLoader } from '../world/streaming/ProgressiveChunkLoader.js';
export { ZONE_STATE, ChunkLoadingZone } from '../world/streaming/ChunkLoadingZone.js';
export { AdaptiveChunkBudget } from '../world/streaming/AdaptiveChunkBudget.js';
export { ChunkWorkerPool } from '../world/streaming/ChunkWorkerPool.js';
export { MovementPredictor } from '../world/streaming/MovementPredictor.js';
export { ChunkUpdater } from '../world/streaming/ChunkUpdater.js';
export { ChunkHistory, HistoryManager } from '../world/streaming/ChunkHistory.js';
export { StructureType, GenerationPhase, ChunkSeamSystem } from '../world/streaming/ChunkSeamSystem.js';

// World storage
export { WorldStorage } from '../world/storage/WorldStorage.js';
export { serializeChunk, deserializeChunk, applyDelta, chunkKey, parseChunkKey, estimateChunkSize, BinaryWriter, BinaryReader } from '../world/storage/ChunkSerializer.js';
export { CompressedChunk, ChunkCompressor } from '../world/storage/PaletteCompression.js';
export { encodeColumn, decodeColumn, RLEChunkCompressor, HybridChunkCompressor } from '../world/storage/RLECompression.js';
export { crc32, verifyCRC32, linearToMorton, mortonToLinear, compressChunk, decompressChunk } from '../world/storage/VoxelCompression.js';
export { RegionFile, RegionManager } from '../world/storage/RegionFile.js';
export { ChunkPersistence } from '../world/storage/ChunkPersistence.js';
export { DiskMeshCache } from '../world/storage/DiskMeshCache.js';
export { ChunkNetworking } from '../world/storage/ChunkNetworking.js';

// Physics
export * from '../sim/physics/index.js';

// Fluids
export { FluidSimulator } from '../sim/fluids/FluidSimulation.js';
export { FDTDSolver } from '../sim/fluids/FDTDSolver.js';
export { PhotonicCrystal } from '../sim/fluids/PhotonicCrystal.js';
export { PhasorRays } from '../sim/fluids/PhasorRays.js';

// GPU utilities
export * from '../core/gpu/index.js';

// Math utilities
export { SpatialHash } from '../core/math/SpatialHash.js';
export { SpatialHashCompute } from '../core/math/SpatialHashCompute.js';
export { INF_T, EPSILON, BVHNode, BVHBuilder, rayTriangleIntersect, traverseBVH, BVH_TRAVERSAL_WGSL, serializeBVHForGPU, createRaycastMesh } from '../core/math/BVHAccel.js';
export { UnionFind, VoxelUnionFind, HybridConnectivity } from '../core/math/UnionFind.js';
export { sdCapsule, capsuleClosestT, bezierDistanceCapsule, bezierDistanceBatch, bezierClosestNewton, bezierDistanceHybrid, multiCurveDistance, multiCurveDistanceSmooth, curvesToGPUBuffer, curvesToSegments, BezierDistanceCompute } from '../core/math/BezierDistance.js';
export { DEFAULT_RESOLUTION, DEFAULT_BLEND_RADIUS, Materials as LineMaterials, NetworkNode, NetworkEdge, LineNetwork, LineToVoxelizer, generateTree, generateRoots, generateTunnel, GPULineVoxelizer } from '../core/math/LineToVoxel.js';

// Memory utilities
export { ObjectPool } from '../core/memory/ObjectPool.js';
export { VertexPool } from '../core/memory/VertexPool.js';
export { MappedBufferRing } from '../core/memory/MappedBufferRing.js';
export { UniformBufferRing } from '../core/memory/UniformBufferRing.js';
export { PipelineCache } from '../core/memory/PipelineCache.js';
export { RenderBundleCache } from '../core/memory/RenderBundleCache.js';
export { ChunkBufferPool } from '../core/memory/ChunkBufferPool.js';
export { SubChunkBufferPool } from '../core/memory/SubChunkBufferPool.js';

// Profiler utilities
export { DualRNG, getGlobalRNG, initGlobalRNG, positionHash } from '../core/profiler/DualRNG.js';
export { FrameBudgetManager, getFrameBudgetManager, shouldSkipWork, DEFAULT_BUDGETS } from '../core/profiler/FrameBudgetManager.js';
export { PerformanceOptimizer } from '../core/profiler/PerformanceOptimizer.js';

// Wind systems
export { WindSystem } from '../sim/world/WindSystem.js';
export { WindSimulation } from '../sim/world/WindSimulation.js';
