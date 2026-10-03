// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelRenderer.js - WebGPU Voxel Terrain Renderer
 * 
 * Renders voxel chunks with:
 * - Batched draw calls
 * - Per-chunk GPU buffers
 * - Basic lighting
 * - Frustum culling
 */

import { VERTEX_STRIDE } from './VoxelMesher.js';
import { CHUNK_SIZE } from './VoxelConstants.js';
import { COMPACT_VERTEX_LAYOUT } from './VoxelMeshCompute.js';
import { FacePool } from './FacePool.js';
import { MeshletCullCompute } from './MeshletCullCompute.js';
import { frustumFromMatrix, frustumNormalizePlanes, frustumContainsAABB } from '../core/math/MathGeometry.js';

// Import shaders from dedicated module
import {
    SHADOW_MAP_SIZE, FRAME_UNIFORMS_STRUCT, FRAME_UNIFORMS_SIZE, FRAME_UNIFORMS_FLOATS,
    FACE_PULL_SHADER, FACE_PULL_SHADOW_SHADER, FACE_PULL_MESHLET_SHADER,
    SHADOW_SHADER, VOXEL_SHADER,
    VOXEL_SHADER_COMPACT_OPAQUE, VOXEL_SHADER_COMPACT_WATER, SHADOW_SHADER_COMPACT
} from './VoxelShaders.js';

// Wrapper for legacy API compatibility
function extractFrustumPlanes(viewProj) {
    const f = frustumNormalizePlanes(frustumFromMatrix(viewProj));
    return [f.left, f.right, f.bottom, f.top, f.near, f.far];
}

function isAABBInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
    const frustum = { left: planes[0], right: planes[1], bottom: planes[2], top: planes[3], near: planes[4], far: planes[5] };
    return frustumContainsAABB(frustum, [minX, minY, minZ], [maxX, maxY, maxZ]);
}

// Shaders moved to VoxelShaders.js

// ============================================================================
// VOXEL RENDERER CLASS
// ============================================================================

export class VoxelRenderer {
    constructor() {
        this.device = null;
        this.pipeline = null;
        this.compactPipeline = null;
        this.compactWaterPipeline = null;
        this.frameBindGroupLayout = null;
        this.chunkBindGroupLayout = null;
        this.frameUniformBuffer = null;
        this.frameBindGroup = null;
        
        // Per-chunk uniform buffers and bind groups
        /** @type {Map<string, { uniformBuffer: GPUBuffer, bindGroup: GPUBindGroup }>} */
        this.chunkResources = new Map();
        
        // ========================================================================
        // BATCHED UNIFORM BUFFER OPTIMIZATION
        // Single writeBuffer call for ALL chunk uniforms instead of per-chunk calls
        // ========================================================================
        this.useBatchedUniforms = true;  // Enable batched uniform optimization
        this.batchedUniformBuffer = null;  // Single large buffer for all chunks
        this.batchedUniformData = null;    // Float32Array for batching
        this.batchedBindGroup = null;      // Single bind group with dynamic offset
        this.maxBatchedChunks = 4096;      // Max chunks we can batch (reduced from 8192 to save 1MB)
        this.uniformsPerChunk = 8;         // 8 floats per chunk (32 bytes, 256-byte aligned)
        this.uniformAlignmentFloats = 64;  // 256 bytes / 4 = 64 floats alignment
        
        // ========================================================================
        // PRE-ALLOCATED BUFFERS - Avoid per-frame/per-chunk allocations
        // ========================================================================
        this._chunkUniformData = new Float32Array(8);  // Reusable for writeChunkUniform
        this._frameUniformData = null;  // Will be allocated in init with correct size
        this._facePullOriginData = new Float32Array(4);  // Reusable for face-pull origins
        this._matMulResult = new Float32Array(16);  // Reusable for matrix multiplication
        
        // Frustum culling
        this.frustumPlanes = null;
        this.culledChunks = 0;
        this.visibleChunks = 0;
        this.useFrustumCulling = true; // Enable frustum culling - skip chunks behind camera
        this.useCaveCulling = false;    // DISABLED - was culling visible underground chunks
        this.useEarlyOut = true;        // Early-out optimizations
        this.hiZPass = null;            // Reference to Hi-Z pass for occlusion culling
        
        // Porcupine neighbor-based culling
        this.usePorcupineCulling = false;  // DISABLED - was culling visible chunks
        this.getChunkCallback = null;     // Callback to get neighbor chunks: (cx, cy, cz) => chunk
        
        // LOD frame counter for staggered out-of-view LOD transitions
        this.lodFrameCounter = 0;
        
        // Cave portal culling - only render chunks reachable from camera through openings
        this.useCavePortalCulling = false;  // DISABLED - was culling visible chunks
        this.visibleChunkKeys = new Set();  // Set of chunk keys visible this frame
        this.portalCullRadius = 16;         // Max radius in chunks for portal BFS
        
        // GPU-driven rendering
        this.useGpuCulling = true;         // Use GPU compute for culling (set externally)
        this.useIndirectDraw = true;       // Use drawIndexedIndirect for GPU-driven rendering
        this.chunkCullCompute = null;       // Reference to ChunkCullCompute instance
        this.gpuCulledChunks = new Set();   // Set of chunk keys that passed GPU culling
        this.indirectDrawBuffer = null;     // GPU buffer for indirect draw commands
        this.chunkDrawData = [];            // Array of chunk draw data for GPU upload
        
        // Face-pull rendering (ultra-compressed: 4 bytes/face)
        this.facePullPipeline = null;
        this.facePullWaterPipeline = null;
        this.facePullShadowPipeline = null;
        this.facePullBindGroupLayout = null;
        this.facePullChunkResources = new Map();  // chunk.key -> {bindGroup, faceBuffer}

        this.useFacePullMeshlets = true;  // INFINITE DETAIL: Enable meshlet rendering
        this.facePullMeshletMaxFaces = 512;
        this.facePullMeshletPipeline = null;
        this.facePullMeshletWaterPipeline = null;
        this.facePullMeshletBindGroupLayout = null;
        this._facePullMeshletBindGroup = null;
        this._facePullWaterMeshletBindGroup = null;
        this._facePullMeshletBindGroupPoolBuffer = null;
        this._facePullWaterMeshletBindGroupPoolBuffer = null;
        this._facePullMeshletPool = null;
        this._facePullWaterMeshletPool = null;
        this._facePullMeshletCull = null;
        this._facePullWaterMeshletCull = null;

        this.textureArrayManager = null;
        this.materialBindGroupLayout = null;
        this.materialBindGroup = null;

        this._fallbackMaterialTextures = null;
        this._fallbackMaterialSampler = null;
        
        // LOD settings - 10-level gradual system
        this.cameraPos = [0, 0, 0];
        this.renderDistance = 12;  // Render distance in chunks (synced from config)
        this.maxRenderDistanceWorld = 384;  // In world units (renderDistance * CHUNK_SIZE)
        this.lodLevels = 10;  // 10 gradual LOD levels (0-9)
        this.lodDistances = [];  // Will be populated with 9 thresholds for 10 levels
        this.useLOD = false;  // LOD DISABLED for testing

        // Screen-space LOD (preferred when enabled, else distance-based)
        this.useScreenLOD = false;  // Disabled by default - use distance-based LOD tied to render distance
        this.maxLODChangePerFrame = 1; // limit how many LOD levels can change per frame (per chunk)
        this.lodStabilityFrames = 14;  // require stable request for N frames before switching LOD (smoother)
        this.minLODTime = 0.2;
        this.screenSize = [1, 1];
        this.lodPixelThresholds = [
            { up: 80, down: 40 },
            { up: 40, down: 20 },
        ];
        this.lastViewProj = null;
        this.lastView = null;
        this.lastProj = null;
        this.currentTime = 0;
        
        // Maximum distance (world units) at which chunks are rendered.
        // 0 or negative means no explicit distance culling (only frustum culling).
        this.maxRenderDistance = 0;
        
        // Shader mode: 0 = terrain, 1 = world/anime (default to world/anime)
        this.shaderMode = 1;
        
        // Shadow mapping
        this.shadowMapTexture = null;
        this.shadowMapView = null;
        this.shadowSampler = null;
        this.shadowPipeline = null;
        this.compactShadowPipeline = null;
        this.shadowUniformBuffer = null;
        this.shadowBindGroupLayout = null;
        this.shadowBindGroup = null;
        this.lightViewProj = null;
        this.shadowBias = 0.0025;
        this.shadowStrength = 0.9;
        this.shadowsEnabled = true;
        
        // Light direction (normalized)
        this.lightDir = [0.4, 0.8, 0.3];
        
        this.initialized = false;
    }

    setTextureArrayManager(textureArrayManager) {
        this.textureArrayManager = textureArrayManager;
        if (this.device) {
            this._updateMaterialBindGroup();
        }
    }

    _updateMaterialBindGroup() {
        if (!this.device || !this.materialBindGroupLayout) {
            this.materialBindGroup = null;
            return;
        }

        let entries = null;

        if (this.textureArrayManager?.initialized) {
            entries = this.textureArrayManager.getPbrBindGroupEntries({
                baseColorTexture: 0,
                materialSampler: 1,
                normalTexture: 2,
                ormTexture: 3,
                heightTexture: 4,
            });
        } else {
            if (!this._fallbackMaterialTextures) {
                const device = this.device;

                const baseColor = device.createTexture({
                    label: 'Fallback Material BaseColor',
                    size: [1, 1, 1],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                const normal = device.createTexture({
                    label: 'Fallback Material Normal',
                    size: [1, 1, 1],
                    format: 'rgba16float',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                const orm = device.createTexture({
                    label: 'Fallback Material ORM',
                    size: [1, 1, 1],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                const height = device.createTexture({
                    label: 'Fallback Material Height',
                    size: [1, 1, 1],
                    format: 'rgba16float',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });

                this._fallbackMaterialSampler = device.createSampler({
                    label: 'Fallback Material Sampler',
                    magFilter: 'linear',
                    minFilter: 'linear',
                    mipmapFilter: 'linear',
                });

                this._fallbackMaterialTextures = { baseColor, normal, orm, height };

                // baseColor: white
                device.queue.writeTexture(
                    { texture: baseColor, origin: [0, 0, 0] },
                    new Uint8Array([255, 255, 255, 255]),
                    { bytesPerRow: 4, rowsPerImage: 1 },
                    { width: 1, height: 1, depthOrArrayLayers: 1 }
                );

                // orm: ao=1, roughness=0.85, metallic=0, height=0
                device.queue.writeTexture(
                    { texture: orm, origin: [0, 0, 0] },
                    new Uint8Array([255, 217, 0, 0]),
                    { bytesPerRow: 4, rowsPerImage: 1 },
                    { width: 1, height: 1, depthOrArrayLayers: 1 }
                );
            }

            const t = this._fallbackMaterialTextures;
            entries = [
                { binding: 0, resource: t.baseColor.createView({ dimension: '2d-array' }) },
                { binding: 1, resource: this._fallbackMaterialSampler },
                { binding: 2, resource: t.normal.createView({ dimension: '2d-array' }) },
                { binding: 3, resource: t.orm.createView({ dimension: '2d-array' }) },
                { binding: 4, resource: t.height.createView({ dimension: '2d-array' }) },
            ];
        }

        this.materialBindGroup = this.device.createBindGroup({
            label: 'Voxel Material Textures',
            layout: this.materialBindGroupLayout,
            entries,
        });
    }
    
    /**
     * Initialize the voxel renderer
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        
        // Create shader module
        const shaderModule = device.createShaderModule({
            code: VOXEL_SHADER,
        });

        // DEBUG: Log compact shader to verify string replacements
        if (!this._compactShaderLogged) {
            this._compactShaderLogged = true;
            console.log('[VoxelRenderer] Compact shader VertexInput:', 
                VOXEL_SHADER_COMPACT_OPAQUE.includes('@location(0) packed: u32') ? 'CORRECT (u32)' : 'WRONG (still float)');
            console.log('[VoxelRenderer] Compact shader unpackVertex:', 
                VOXEL_SHADER_COMPACT_OPAQUE.includes('unpackVertex(input.packed') ? 'PRESENT' : 'MISSING');
            // Check for remaining VertexInput references in vertex shader portion
            // Note: input.normal/color in FRAGMENT shader refers to VertexOutput, which is correct
            // Only input.position in vertex shader would be wrong (should use unpacked.position)
            const vsSection = VOXEL_SHADER_COMPACT_OPAQUE.split('@fragment')[0];
            const hasInputPositionInVS = vsSection.includes('input.position');
            const hasInputNormalInVS = vsSection.includes('= input.normal');
            const hasInputColorInVS = vsSection.includes('input.color.rgb') || vsSection.includes('input.color.a');
            console.log('[VoxelRenderer] Compact VS refs: position=' + hasInputPositionInVS + ', normal=' + hasInputNormalInVS + ', color=' + hasInputColorInVS);
            if (hasInputPositionInVS || hasInputNormalInVS || hasInputColorInVS) {
                console.error('[VoxelRenderer] SHADER ERROR: VertexInput still referenced in vertex shader!');
            }
        }
        
        const compactShaderModuleOpaque = device.createShaderModule({
            code: VOXEL_SHADER_COMPACT_OPAQUE,
        });

        const compactShaderModuleWater = device.createShaderModule({
            code: VOXEL_SHADER_COMPACT_WATER,
        });
        
        // Create shadow map texture
        this.shadowMapTexture = device.createTexture({
            size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, 1],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            label: 'VoxelShadowMap',
        });
        this.shadowMapView = this.shadowMapTexture.createView();
        
        // Shadow sampler (comparison sampler for PCF)
        this.shadowSampler = device.createSampler({
            compare: 'less',
            magFilter: 'linear',
            minFilter: 'linear',
        });
        
        // Create dummy 3D texture for aerial perspective LUT (when Hillaire is not available)
        this.dummyAerialLUT = device.createTexture({
            size: [2, 2, 2],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING,
            dimension: '3d',
            label: 'DummyAerialPerspectiveLUT',
        });
        this.dummyAerialLUTView = this.dummyAerialLUT.createView();
        
        // Aerial perspective sampler
        this.aerialPerspectiveSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });
        
        // Hillaire atmosphere reference (set externally)
        this.hillaireAtmosphere = null;
        
        // Shadow pass uniform buffer (just lightViewProj)
        this.shadowUniformBuffer = device.createBuffer({
            size: 64, // mat4x4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'VoxelShadowUniforms',
        });
        
        // Shadow pass bind group layout
        this.shadowBindGroupLayout = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' },
            }],
        });
        
        // Shadow pass bind group
        this.shadowBindGroup = device.createBindGroup({
            layout: this.shadowBindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: this.shadowUniformBuffer },
            }],
        });
        
        // Water height map texture (orthographic from above)
        const WATER_MAP_SIZE = 512;
        this.waterMapSize = WATER_MAP_SIZE;
        this.waterMapTexture = device.createTexture({
            size: [WATER_MAP_SIZE, WATER_MAP_SIZE, 1],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            label: 'WaterHeightMap',
        });
        this.waterMapView = this.waterMapTexture.createView();
        
        // Water sampler (non-filtering for depth texture)
        this.waterSampler = device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        
        // Water pass uniform buffer (just waterViewProj)
        this.waterUniformBuffer = device.createBuffer({
            size: 64, // mat4x4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'WaterPassUniforms',
        });
        
        // Water pass bind group (same layout as shadow)
        this.waterPassBindGroup = device.createBindGroup({
            layout: this.shadowBindGroupLayout,  // Reuse shadow layout (just uniform)
            entries: [{
                binding: 0,
                resource: { buffer: this.waterUniformBuffer },
            }],
        });
        
        // Frame uniforms bind group layout (group 0) - includes shadow map, water map, and aerial perspective LUT
        this.frameBindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'comparison' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' },  // Must match texture_depth_2d in shader
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },  // Regular sampler
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '3d' },  // Hillaire Aerial Perspective LUT
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },  // Aerial perspective sampler
                },
            ],
        });
        
        // Chunk uniforms bind group layout (group 1)
        this.chunkBindGroupLayout = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform', hasDynamicOffset: true },
            }],
        });

        this.materialBindGroupLayout = device.createBindGroupLayout({
            label: 'Voxel Material Textures Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
            ],
        });

        this._updateMaterialBindGroup();
        
        // ========================================================================
        // BATCHED UNIFORM BUFFER - Single buffer for ALL chunk uniforms
        // Reduces 2000+ writeBuffer calls to just 1 per frame
        // ========================================================================
        if (this.useBatchedUniforms) {
            const alignment = device.limits.minUniformBufferOffsetAlignment; // 256 bytes
            this.uniformAlignmentBytes = alignment;
            this.uniformAlignmentFloats = alignment / 4;  // 64 floats
            
            // Each chunk needs 256 bytes (aligned), for 8192 chunks = 2MB buffer
            const bufferSize = this.maxBatchedChunks * alignment;
            this.batchedUniformBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                label: 'BatchedChunkUniforms',
            });
            
            // Pre-allocate typed array for batching
            this.batchedUniformData = new Float32Array(this.maxBatchedChunks * this.uniformAlignmentFloats);
            
            // Single bind group with dynamic offset
            this.batchedBindGroup = device.createBindGroup({
                layout: this.chunkBindGroupLayout,
                entries: [{
                    binding: 0,
                    resource: {
                        buffer: this.batchedUniformBuffer,
                        offset: 0,
                        size: alignment,
                    },
                }],
            });
            
            console.log(`[VoxelRenderer] Batched uniforms: ${this.maxBatchedChunks} chunks, ${bufferSize / 1024 / 1024}MB buffer, ${alignment}B alignment`);
        }
        
        // Pre-allocate frame uniform data buffer (avoid per-frame allocation)
        this._frameUniformData = new Float32Array(FRAME_UNIFORMS_FLOATS);
        
        // Pipeline layout
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.frameBindGroupLayout, this.chunkBindGroupLayout, this.materialBindGroupLayout],
        });
        
        // Vertex buffer layout
        const vertexBufferLayout = {
            arrayStride: VERTEX_STRIDE * 4, // 10 floats * 4 bytes
            attributes: [
                { // position
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3',
                },
                { // normal
                    shaderLocation: 1,
                    offset: 12,
                    format: 'float32x3',
                },
                { // color
                    shaderLocation: 2,
                    offset: 24,
                    format: 'float32x4',
                },
            ],
        };

        const compactVertexBufferLayout = {
            ...COMPACT_VERTEX_LAYOUT,
            stepMode: 'vertex',
        };
        
        // Create render pipeline (opaque geometry)
        this.pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });

        this.compactPipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: compactShaderModuleOpaque,
                entryPoint: 'vs_main',
                buffers: [compactVertexBufferLayout],
            },
            fragment: {
                module: compactShaderModuleOpaque,
                entryPoint: 'fs_main',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        
        // Create water pipeline (transparent geometry)
        // Key differences: no depth write, depth test less-equal, no backface culling
        this.waterPipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',  // Cull backfaces - front faces only
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: false,  // Don't write to depth (transparent)
                depthCompare: 'less-equal', // Draw if same depth or closer
            },
        });

        this.compactWaterPipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: compactShaderModuleWater,
                entryPoint: 'vs_main',
                buffers: [compactVertexBufferLayout],
            },
            fragment: {
                module: compactShaderModuleWater,
                entryPoint: 'fs_main',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: false,
                depthCompare: 'less-equal',
            },
        });
        
        // Create frame uniform buffer with dynamically calculated size
        // Uses calcWGSLStructSize() to prevent buffer size mismatch errors
        this.frameUniformBuffer = device.createBuffer({
            label: 'VoxelRenderer Frame Uniforms',
            size: FRAME_UNIFORMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        console.log(`[VoxelRenderer] Frame uniform buffer: ${FRAME_UNIFORMS_SIZE} bytes (${FRAME_UNIFORMS_FLOATS} floats)`);
        
        // Create frame bind group (includes shadow map, water map, aerial perspective LUT, and samplers)
        this._updateFrameBindGroup();
        
        // Create shadow pass shader module
        const shadowShaderModule = device.createShaderModule({
            code: SHADOW_SHADER,
        });

        const compactShadowShaderModule = device.createShaderModule({
            code: SHADOW_SHADER_COMPACT,
        });
        
        // Shadow pipeline layout
        const shadowPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.shadowBindGroupLayout, this.chunkBindGroupLayout],
        });
        
        // Create shadow render pipeline (depth-only, no fragment shader)
        this.shadowPipeline = device.createRenderPipeline({
            layout: shadowPipelineLayout,
            vertex: {
                module: shadowShaderModule,
                entryPoint: 'vs_shadow',
                buffers: [vertexBufferLayout],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: 'less',
                depthBias: 2,
                depthBiasSlopeScale: 2.0,
            },
        });

        this.compactShadowPipeline = device.createRenderPipeline({
            layout: shadowPipelineLayout,
            vertex: {
                module: compactShadowShaderModule,
                entryPoint: 'vs_shadow',
                buffers: [compactVertexBufferLayout],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: 'less',
                depthBias: 2,
                depthBiasSlopeScale: 2.0,
            },
        });
        
        // Initialize default light view-projection
        this.lightViewProj = new Float32Array(16);
        this.updateLightMatrix([0, 0, 0], 100);
        
        // Initialize water height map matrix
        this.waterViewProj = new Float32Array(16);
        this.waterCausticsEnabled = true;  // Enable caustics by default
        this.updateWaterMatrix([0, 0, 0], 100);
        
        // ====================================================================
        // FACE-PULL PIPELINE (Ultra-compressed: 4 bytes per face!)
        // No vertex buffer - uses vertex pulling from storage buffer
        // ====================================================================
        await this._initFacePullPipelines(device);

        try {
            this._facePullMeshletPool = new FacePool({ facesCapacity: 1024 * 1024 });
            await this._facePullMeshletPool.init(device);

            this._facePullWaterMeshletPool = new FacePool({ facesCapacity: 512 * 1024 });
            await this._facePullWaterMeshletPool.init(device);

            this._facePullMeshletCull = new MeshletCullCompute();
            await this._facePullMeshletCull.init(device, {
                maxMeshlets: 65536,
                vertexCountPerInstance: this.facePullMeshletMaxFaces * 6,
            });

            this._facePullWaterMeshletCull = new MeshletCullCompute();
            await this._facePullWaterMeshletCull.init(device, {
                maxMeshlets: 65536,
                vertexCountPerInstance: this.facePullMeshletMaxFaces * 6,
            });
        } catch (err) {
            console.warn('[VoxelRenderer] Face-pull meshlet init skipped:', err?.message ?? err);
        }
        
        this.initialized = true;
    }
    
    async _initFacePullPipelines(device) {
        try {
            const facePullModule = device.createShaderModule({
                label: 'Face Pull Shader',
                code: FACE_PULL_SHADER,
            });

            const facePullMeshletModule = device.createShaderModule({
                label: 'Face Pull Meshlet Shader',
                code: FACE_PULL_MESHLET_SHADER,
            });
            
            const facePullShadowModule = device.createShaderModule({
                label: 'Face Pull Shadow Shader',
                code: FACE_PULL_SHADOW_SHADER,
            });
            
            this.facePullBindGroupLayout = device.createBindGroupLayout({
                label: 'Face Pull Chunk Layout',
                entries: [
                    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                ],
            });

            this.facePullMeshletBindGroupLayout = device.createBindGroupLayout({
                label: 'Face Pull Meshlet Layout',
                entries: [
                    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                ],
            });
            
            const facePullPipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [this.frameBindGroupLayout, this.facePullBindGroupLayout, this.materialBindGroupLayout],
            });
            
            this.facePullPipeline = device.createRenderPipeline({
                label: 'Face Pull Pipeline',
                layout: facePullPipelineLayout,
                vertex: {
                    module: facePullModule,
                    entryPoint: 'vertexMain',
                    buffers: [],
                },
                fragment: {
                    module: facePullModule,
                    entryPoint: 'fs_facepull',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'back',
                    frontFace: 'ccw',
                },
                depthStencil: {
                    format: 'depth24plus',
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                },
            });

            const facePullMeshletPipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [this.frameBindGroupLayout, this.facePullMeshletBindGroupLayout, this.materialBindGroupLayout],
            });

            this.facePullMeshletPipeline = device.createRenderPipeline({
                label: 'Face Pull Meshlet Pipeline',
                layout: facePullMeshletPipelineLayout,
                vertex: {
                    module: facePullMeshletModule,
                    entryPoint: 'vertexMain',
                    buffers: [],
                },
                fragment: {
                    module: facePullMeshletModule,
                    entryPoint: 'fs_facepull',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'back',
                    frontFace: 'ccw',
                },
                depthStencil: {
                    format: 'depth24plus',
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                },
            });

            this.facePullMeshletWaterPipeline = device.createRenderPipeline({
                label: 'Face Pull Meshlet Water Pipeline',
                layout: facePullMeshletPipelineLayout,
                vertex: {
                    module: facePullMeshletModule,
                    entryPoint: 'vertexMain',
                    buffers: [],
                },
                fragment: {
                    module: facePullMeshletModule,
                    entryPoint: 'fs_facepull',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'back',
                    frontFace: 'ccw',
                },
                depthStencil: {
                    format: 'depth24plus',
                    depthWriteEnabled: false,
                    depthCompare: 'less-equal',
                },
            });
            
            this.facePullWaterPipeline = device.createRenderPipeline({
                label: 'Face Pull Water Pipeline',
                layout: facePullPipelineLayout,
                vertex: {
                    module: facePullModule,
                    entryPoint: 'vertexMain',
                    buffers: [],
                },
                fragment: {
                    module: facePullModule,
                    entryPoint: 'fs_facepull',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'back',
                    frontFace: 'ccw',
                },
                depthStencil: {
                    format: 'depth24plus',
                    depthWriteEnabled: false,
                    depthCompare: 'less-equal',
                },
            });
            
            const facePullShadowLayout = device.createPipelineLayout({
                bindGroupLayouts: [this.shadowBindGroupLayout, this.facePullBindGroupLayout],
            });
            
            this.facePullShadowPipeline = device.createRenderPipeline({
                label: 'Face Pull Shadow Pipeline',
                layout: facePullShadowLayout,
                vertex: {
                    module: facePullShadowModule,
                    entryPoint: 'vs_shadow',
                    buffers: [],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'back',
                    frontFace: 'ccw',
                },
                depthStencil: {
                    format: 'depth32float',
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                    depthBias: 2,
                    depthBiasSlopeScale: 2.0,
                },
            });
            
            console.log('[VoxelRenderer] Face-pull pipelines initialized (4 bytes/face!)');
        } catch (err) {
            console.warn('[VoxelRenderer] Face-pull pipeline init failed:', err.message);
        }
    }
    
    /**
     * Compute orthographic light view-projection matrix for shadow mapping
     * @param {number[]} sceneCenter - Center of the scene to shadow
     * @param {number} sceneRadius - Radius of the scene to cover
     */
    updateLightMatrix(sceneCenter, sceneRadius) {
        // Normalize light direction
        const lx = this.lightDir[0];
        const ly = this.lightDir[1];
        const lz = this.lightDir[2];
        const len = Math.sqrt(lx*lx + ly*ly + lz*lz);
        const dirX = lx / len;
        const dirY = ly / len;
        const dirZ = lz / len;
        
        // Light position (far back along light direction)
        const dist = sceneRadius * 2;
        const lightPosX = sceneCenter[0] + dirX * dist;
        const lightPosY = sceneCenter[1] + dirY * dist;
        const lightPosZ = sceneCenter[2] + dirZ * dist;
        
        // Look-at matrix (light looks toward scene center)
        const view = this.lookAt(
            [lightPosX, lightPosY, lightPosZ],
            sceneCenter,
            [0, 1, 0]
        );
        
        // Orthographic projection
        const size = sceneRadius * 1.5;
        const near = 0.1;
        const far = dist * 2 + sceneRadius;
        const proj = this.ortho(-size, size, -size, size, near, far);
        
        // Combine: proj * view
        this.lightViewProj = this.multiplyMat4(proj, view);
        
        // Update shadow uniform buffer
        if (this.device && this.shadowUniformBuffer) {
            this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, this.lightViewProj);
        }
    }
    
    /**
     * Compute orthographic water height map matrix (looking down from above)
     * @param {number[]} sceneCenter - Center of the scene
     * @param {number} sceneRadius - Radius of the scene to cover
     */
    updateWaterMatrix(sceneCenter, sceneRadius) {
        // Position high above scene looking down
        // Height needs to be above the highest terrain to capture all water surfaces
        const height = 500;
        const waterPosX = sceneCenter[0];
        const waterPosY = sceneCenter[1] + height;
        const waterPosZ = sceneCenter[2];
        
        // Look straight down
        const view = this.lookAt(
            [waterPosX, waterPosY, waterPosZ],
            [sceneCenter[0], sceneCenter[1], sceneCenter[2]],
            [0, 0, 1]  // Up is along Z when looking down
        );
        
        // Orthographic projection covering the scene
        // Size should cover the full visible area for caustics
        const size = sceneRadius;
        const near = 1.0;
        const far = height + 200;  // Far enough to see deep underwater terrain
        const proj = this.ortho(-size, size, -size, size, near, far);
        
        // Combine: proj * view
        this.waterViewProj = this.multiplyMat4(proj, view);
        
        // Update water uniform buffer
        if (this.device && this.waterUniformBuffer) {
            this.device.queue.writeBuffer(this.waterUniformBuffer, 0, this.waterViewProj);
        }
    }
    
    /**
     * Update frame bind group (called when Hillaire LUT changes)
     * @private
     */
    _updateFrameBindGroup() {
        if (!this.device || !this.frameBindGroupLayout) return;
        
        // Get aerial perspective LUT from Hillaire system, or use dummy
        let aerialLUTView = this.dummyAerialLUTView;
        if (this.hillaireAtmosphere?.initialized) {
            const lutViews = this.hillaireAtmosphere.getLUTViews();
            if (lutViews?.aerialPerspective) {
                aerialLUTView = lutViews.aerialPerspective;
            }
        }
        
        this.frameBindGroup = this.device.createBindGroup({
            layout: this.frameBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.frameUniformBuffer } },
                { binding: 1, resource: this.shadowMapView },
                { binding: 2, resource: this.shadowSampler },
                { binding: 3, resource: this.waterMapView },
                { binding: 4, resource: this.waterSampler },
                { binding: 5, resource: aerialLUTView },
                { binding: 6, resource: this.aerialPerspectiveSampler },
            ],
        });
    }
    
    /**
     * Connect to Hillaire LUT atmosphere system for aerial perspective
     * @param {HillaireAtmosphere} hillaireAtmosphere - The Hillaire atmosphere system
     */
    setHillaireAtmosphere(hillaireAtmosphere) {
        this.hillaireAtmosphere = hillaireAtmosphere;
        this._updateFrameBindGroup();
        if (hillaireAtmosphere?.initialized) {
            console.log('[VoxelRenderer] Connected to Hillaire Aerial Perspective LUT');
        }
    }
    
    /** Create look-at view matrix */
    lookAt(eye, target, up) {
        const zx = eye[0] - target[0];
        const zy = eye[1] - target[1];
        const zz = eye[2] - target[2];
        const zLen = Math.sqrt(zx*zx + zy*zy + zz*zz);
        const z = [zx/zLen, zy/zLen, zz/zLen];
        
        // x = up cross z
        let xx = up[1]*z[2] - up[2]*z[1];
        let xy = up[2]*z[0] - up[0]*z[2];
        let xz = up[0]*z[1] - up[1]*z[0];
        const xLen = Math.sqrt(xx*xx + xy*xy + xz*xz);
        const x = [xx/xLen, xy/xLen, xz/xLen];
        
        // y = z cross x
        const y = [
            z[1]*x[2] - z[2]*x[1],
            z[2]*x[0] - z[0]*x[2],
            z[0]*x[1] - z[1]*x[0],
        ];
        
        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -(x[0]*eye[0] + x[1]*eye[1] + x[2]*eye[2]),
            -(y[0]*eye[0] + y[1]*eye[1] + y[2]*eye[2]),
            -(z[0]*eye[0] + z[1]*eye[1] + z[2]*eye[2]),
            1,
        ]);
    }
    
    /** Create orthographic projection matrix (WebGPU: Z maps to [0,1]) */
    ortho(left, right, bottom, top, near, far) {
        // WebGPU uses [0, 1] depth range, not [-1, 1] like OpenGL
        const width = right - left;
        const height = top - bottom;
        const depth = far - near;
        
        return new Float32Array([
            2 / width, 0, 0, 0,
            0, 2 / height, 0, 0,
            0, 0, 1 / depth, 0,
            -(left + right) / width, -(top + bottom) / height, -near / depth, 1,
        ]);
    }
    
    /** Multiply two 4x4 matrices (uses pre-allocated buffer) */
    multiplyMat4(a, b) {
        const out = this._matMulResult;
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                out[i*4+j] = a[j]*b[i*4] + a[4+j]*b[i*4+1] + a[8+j]*b[i*4+2] + a[12+j]*b[i*4+3];
            }
        }
        return out;
    }
    
    /**
     * Update frame uniforms (including shadow data, sun, and realm parameters)
     * @param {Float32Array} viewProj - 4x4 view-projection matrix
     * @param {Float32Array} view - 4x4 view matrix
     * @param {Float32Array} proj - 4x4 projection matrix
     * @param {number[]} cameraPos - [x, y, z]
     * @param {number} time 
     * @param {Object} realm - Optional realm parameters { ambientLight, fogColor, fogDensity, sunDirection, sunColor, sunIntensity }
     */
    updateFrameUniforms(viewProj, view, proj, cameraPos, time, realm = null) {
        // Get sun direction from realm (or use default)
        const sunDir = realm?.sunDirection ?? this.lightDir;
        const sunColor = realm?.sunColor ?? [1.0, 1.0, 1.0];
        const sunIntensity = realm?.sunIntensity ?? 1.0;
        
        // Update light direction for shadows to follow sun
        this.lightDir = [sunDir[0], sunDir[1], sunDir[2]];
        
        // Update light matrix based on camera position (larger radius for distant shadows)
        this.updateLightMatrix(cameraPos, 250);
        
        // Update water height map matrix (orthographic from above, centered on camera)
        this.updateWaterMatrix(cameraPos, 300);
        
        // Default realm values (surface)
        const ambientLight = realm?.ambientLight ?? 1.0;
        const fogColor = realm?.fogColor ?? [0.35, 0.45, 0.55];
        const fogDensity = realm?.fogDensity ?? 0.008;
        
        // Use pre-allocated buffer to avoid per-frame allocation
        const data = this._frameUniformData || new Float32Array(FRAME_UNIFORMS_FLOATS);
        data.set(viewProj, 0);      // 0-15: viewProj
        data.set(view, 16);         // 16-31: view
        data.set(proj, 32);         // 32-47: proj
        data.set(this.lightViewProj, 48); // 48-63: lightViewProj
        data.set(this.waterViewProj, 64); // 64-79: waterViewProj
        data[80] = cameraPos[0];    // 80: cameraPos.x
        data[81] = cameraPos[1];    // 81: cameraPos.y
        data[82] = cameraPos[2];    // 82: cameraPos.z
        data[83] = time;            // 83: time
        // Sun direction (normalized)
        const sunLen = Math.sqrt(sunDir[0]*sunDir[0] + sunDir[1]*sunDir[1] + sunDir[2]*sunDir[2]) || 1;
        data[84] = sunDir[0] / sunLen;  // 84: sunDirection.x
        data[85] = sunDir[1] / sunLen;  // 85: sunDirection.y
        data[86] = sunDir[2] / sunLen;  // 86: sunDirection.z
        data[87] = sunIntensity;        // 87: sunIntensity
        // Sun color
        data[88] = sunColor[0];         // 88: sunColor.r
        data[89] = sunColor[1];         // 89: sunColor.g
        data[90] = sunColor[2];         // 90: sunColor.b
        data[91] = ambientLight;        // 91: ambientLight
        // Shader settings
        data[92] = this.shaderMode || 0; // 92: shaderMode
        data[93] = this.shadowBias;      // 93: shadowBias
        data[94] = this.shadowsEnabled ? this.shadowStrength : 0.0; // 94: shadowStrength
        data[95] = 0.0;                  // 95: _pad1
        // Fog
        data[96] = fogColor[0];          // 96: fogColor.r
        data[97] = fogColor[1];          // 97: fogColor.g
        data[98] = fogColor[2];          // 98: fogColor.b
        data[99] = fogDensity;           // 99: fogDensity
        // Water
        data[100] = this.waterCausticsEnabled ? 1.0 : 0.0; // 100: waterEnabled
        data[101] = 0.0;                 // 101: _pad2.x
        data[102] = 0.0;                 // 102: _pad2.y
        data[103] = 0.0;                 // 103: _pad2.z
        
        // ========================================
        // TERRAIN SHADING CONFIG (from world.cfg)
        // ========================================
        const ts = this.terrainShading || {};
        const ao = this.aoSettings || {};
        const pd = this.proceduralDetail || {};
        
        // Triplanar settings (104-107)
        data[104] = ts.triplanarScale ?? 0.1;
        data[105] = ts.triplanarSharpness ?? 4.0;
        data[106] = ts.triplanarEnabled !== false ? 1.0 : 0.0;
        data[107] = ts.slopeBlendEnabled !== false ? 1.0 : 0.0;
        
        // Slope thresholds (108-111)
        data[108] = ts.grassSlopeMax ?? 0.3;
        data[109] = ts.dirtSlopeMax ?? 0.6;
        data[110] = ts.rockSlopeMin ?? 0.6;
        data[111] = ts.heightBlendEnabled !== false ? 1.0 : 0.0;
        
        // Height thresholds (112-115)
        data[112] = ts.sandHeightMax ?? 5;
        data[113] = ts.snowHeightMin ?? 80;
        data[114] = ts.peakRockHeight ?? 100;
        data[115] = ts.biomeColorsEnabled !== false ? 1.0 : 0.0;
        
        // AO and detail (116-119)
        data[116] = ao.edgeDarkening ?? 0.08;
        data[117] = pd.noiseIntensity ?? 0.2;
        data[118] = pd.fineDetailIntensity ?? 0.1;
        data[119] = ts.biomeBlendSharpness ?? 1.0;
        
        this.device.queue.writeBuffer(this.frameUniformBuffer, 0, data.buffer);

        // Cache for screen-space LOD
        this.cameraPos = cameraPos;
        this.lastViewProj = viewProj;
        this.lastView = view;
        this.lastProj = proj;
        this.currentTime = time;
        
        // Extract frustum planes for culling
        this.frustumPlanes = extractFrustumPlanes(viewProj);
    }
    
    /**
     * Update screen size for screen-space LOD
     * @param {number} width 
     * @param {number} height 
     */
    setScreenSize(width, height) {
        this.screenSize = [width, height];
    }

    setShaderMode(mode) {
        this.shaderMode = mode | 0;
    }

    toggleShaderMode() {
        this.shaderMode = this.shaderMode === 0 ? 1 : 0;
    }
    
    /**
     * Get or create resources for a chunk
     * @param {VoxelChunk} chunk 
     */
    getChunkResources(chunk) {
        let resources = this.chunkResources.get(chunk.key);
        
        if (!resources) {
            // Create uniform buffer for chunk offset + blend + geomorphing
            const uniformBuffer = this.device.createBuffer({
                size: 32, // vec3 + blend + morphFactor + lodLevel + cameraDistance + pad
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            
            // Initial write (blend=1, no morph) - use pre-allocated buffer
            const [ox, oy, oz] = chunk.getWorldOrigin();
            const data = this._chunkUniformData;
            data[0] = ox; data[1] = oy; data[2] = oz; data[3] = 1;
            data[4] = 0; data[5] = 0; data[6] = 0; data[7] = 0;
            this.device.queue.writeBuffer(uniformBuffer, 0, data);
            
            // Create bind group
            const bindGroup = this.device.createBindGroup({
                layout: this.chunkBindGroupLayout,
                entries: [{
                    binding: 0,
                    resource: { buffer: uniformBuffer },
                }],
            });
            
            resources = { uniformBuffer, bindGroup };
            this.chunkResources.set(chunk.key, resources);
        }
        
        return resources;
    }
    
    /** Write chunk uniforms (offset + blend + geomorphing) */
    writeChunkUniform(resources, chunk, blend = 1.0, morphFactor = 0.0, lodLevel = 0) {
        if (!resources || !resources.uniformBuffer) return;
        const [ox, oy, oz] = chunk.getWorldOrigin();
        
        // Calculate camera distance for morph factor
        const cx = ox + CHUNK_SIZE * 0.5;
        const cy = oy + CHUNK_SIZE * 0.5;
        const cz = oz + CHUNK_SIZE * 0.5;
        const dx = cx - this.cameraPos[0];
        const dy = cy - this.cameraPos[1];
        const dz = cz - this.cameraPos[2];
        const cameraDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // 8 floats: worldOffset(3) + blend(1) + morphFactor(1) + lodLevel(1) + cameraDistance(1) + pad(1)
        // Use pre-allocated buffer to avoid per-chunk allocation
        const data = this._chunkUniformData;
        data[0] = ox; data[1] = oy; data[2] = oz; data[3] = blend;
        data[4] = morphFactor; data[5] = lodLevel; data[6] = cameraDistance; data[7] = 0.0;
        this.device.queue.writeBuffer(resources.uniformBuffer, 0, data);
    }
    
    /**
     * Write chunk uniform data to batched buffer at given index
     * @param {number} index - Chunk index in batch (0 to maxBatchedChunks-1)
     * @param {VoxelChunk} chunk - Chunk to write uniforms for
     * @returns {number} Byte offset in batched buffer
     */
    writeBatchedChunkUniform(index, chunk) {
        if (!this.useBatchedUniforms || !this.batchedUniformData) return 0;
        
        const [ox, oy, oz] = chunk.getWorldOrigin();
        const cx = ox + CHUNK_SIZE * 0.5;
        const cy = oy + CHUNK_SIZE * 0.5;
        const cz = oz + CHUNK_SIZE * 0.5;
        const dx = cx - this.cameraPos[0];
        const dy = cy - this.cameraPos[1];
        const dz = cz - this.cameraPos[2];
        const cameraDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Write at aligned offset (64 floats per chunk for 256-byte alignment)
        const floatOffset = index * this.uniformAlignmentFloats;
        this.batchedUniformData[floatOffset + 0] = ox;
        this.batchedUniformData[floatOffset + 1] = oy;
        this.batchedUniformData[floatOffset + 2] = oz;
        this.batchedUniformData[floatOffset + 3] = 1.0;  // blend
        this.batchedUniformData[floatOffset + 4] = 0.0;  // morphFactor
        this.batchedUniformData[floatOffset + 5] = 0.0;  // lodLevel
        this.batchedUniformData[floatOffset + 6] = cameraDistance;
        this.batchedUniformData[floatOffset + 7] = 0.0;  // pad
        
        return index * this.uniformAlignmentBytes;
    }
    
    /**
     * Flush all batched uniforms to GPU with single writeBuffer call
     * @param {number} chunkCount - Number of chunks written
     */
    flushBatchedUniforms(chunkCount) {
        if (!this.useBatchedUniforms || chunkCount === 0) return;
        
        // Write only the portion we used
        const bytesToWrite = chunkCount * this.uniformAlignmentBytes;
        const floatsToWrite = chunkCount * this.uniformAlignmentFloats;
        
        // Single writeBuffer call for ALL chunks
        this.device.queue.writeBuffer(
            this.batchedUniformBuffer,
            0,
            this.batchedUniformData.buffer,
            0,
            bytesToWrite
        );
    }
    
    /**
     * Calculate geomorph factor for smooth LOD transitions
     * Returns 0.0 at LOD boundary start, 1.0 at LOD boundary end
     */
    calculateMorphFactor(distance, lodLevel) {
        if (!this.geomorphing) return 0.0;
        
        // LOD distance thresholds
        const lodDistances = [
            this.lod0Distance * CHUNK_SIZE,
            this.lod1Distance * CHUNK_SIZE,
            this.lod2Distance * CHUNK_SIZE,
            this.lod2Distance * CHUNK_SIZE * 1.5,
        ];
        
        const currentThreshold = lodDistances[lodLevel] || lodDistances[lodDistances.length - 1];
        const nextThreshold = lodDistances[lodLevel + 1] || currentThreshold * 2;
        
        // Morph zone is last 20% of each LOD band
        const morphStart = currentThreshold + (nextThreshold - currentThreshold) * 0.8;
        
        if (distance < morphStart) return 0.0;
        if (distance >= nextThreshold) return 1.0;
        
        return (distance - morphStart) / (nextThreshold - morphStart);
    }
    
    /**
     * Remove resources for a chunk
     * @param {string} chunkKey 
     */
    removeChunkResources(chunkKey) {
        const resources = this.chunkResources.get(chunkKey);
        if (resources) {
            resources.uniformBuffer.destroy();
            this.chunkResources.delete(chunkKey);
        }
    }
    
    /**
     * Attach an external ShadowAtlas — the voxel fragment shader will sample
     * from the atlas depth texture instead of the renderer's own shadow map.
     * Call once after init(). The atlas texture must be depth32float.
     * @param {{ textureView: GPUTextureView }} atlas
     */
    useShadowAtlas(atlas) {
        if (atlas && atlas.textureView) {
            this.shadowMapView = atlas.textureView;
            this._usingShadowAtlas = true;
        }
    }

    /**
     * Patch the lightViewProj region of the already-uploaded frame uniform buffer.
     * Call AFTER atlas.computeLightMatrix() and AFTER updateFrameUniforms().
     * This overwrites floats [48..63] (byte offset 192, 64 bytes).
     * @param {Float32Array} lightViewProj - 16-float column-major matrix
     */
    patchLightViewProj(lightViewProj) {
        if (!lightViewProj || !this.frameUniformBuffer) return;
        // Also store locally so next updateFrameUniforms picks it up
        if (this.lightViewProj) this.lightViewProj.set(lightViewProj);
        // Patch the already-written frame uniform buffer in-place
        this.device.queue.writeBuffer(this.frameUniformBuffer, 48 * 4, lightViewProj);
    }

    /**
     * Flush voxel chunk shadow depth into an EXISTING render pass.
     * Conforms to the ShadowAtlas caster interface: { flush(pass, lightViewProj) }.
     * Updates the internal shadow uniform buffer with the supplied lightViewProj
     * so voxel shadow pipelines use the correct light matrix.
     *
     * @param {GPURenderPassEncoder} pass - An active depth-only render pass
     * @param {Float32Array} lightViewProj - 4×4 light view-projection matrix
     */
    flushShadowChunks(pass, lightViewProj) {
        if (!this.initialized || !this.shadowsEnabled) return;

        // Upload the atlas-provided lightViewProj into our shadow uniform buffer
        // so the voxel shadow vertex shaders pick it up from group(0) binding(0)
        if (lightViewProj && this.shadowUniformBuffer) {
            this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, lightViewProj);
        }

        let activeShadowPipeline = null;
        pass.setBindGroup(0, this.shadowBindGroup);

        const maxShadowDist = 220;
        const maxShadowDistSq = maxShadowDist * maxShadowDist;

        const chunks = this._shadowChunks || [];
        for (const chunk of chunks) {
            // Distance culling for shadow casters
            const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
            const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
            const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
            const dx = cx - this.cameraPos[0];
            const dy = cy - this.cameraPos[1];
            const dz = cz - this.cameraPos[2];
            const distSq = dx*dx + dy*dy + dz*dz;
            if (distSq > maxShadowDistSq) {
                continue;
            }

            // Face-pull shadow rendering (ultra-compressed chunks)
            if (chunk.useFacePull && chunk.opaqueFaceBuffer && this.facePullShadowPipeline) {
                const bindGroup = this._getFacePullBindGroup(chunk);
                if (!bindGroup) continue;

                if (activeShadowPipeline !== this.facePullShadowPipeline) {
                    pass.setPipeline(this.facePullShadowPipeline);
                    activeShadowPipeline = this.facePullShadowPipeline;
                }
                pass.setBindGroup(1, bindGroup);
                pass.draw(chunk.opaqueFaceCount * 6);
                continue;
            }

            // Use LOD0 for shadows (best quality) or current LOD for performance
            let vertexBuffer = chunk.vertexBuffer;
            let indexBuffer = chunk.indexBuffer;
            let indexCount = chunk.indexCount;

            // For distant chunks, use lower LOD for shadow rendering
            const lod = this.useLOD ? this.getChunkLOD(chunk) : 0;
            if (!chunk.useGpuBuffers && lod > 0 && chunk.lodBuffers && chunk.lodBuffers[lod]) {
                vertexBuffer = chunk.lodBuffers[lod].vertexBuffer;
                indexBuffer = chunk.lodBuffers[lod].indexBuffer;
                indexCount = chunk.lodBuffers[lod].indexCount;
            }

            if (!vertexBuffer || !indexBuffer) continue;
            if (indexCount < 0 || indexCount === undefined) continue;
            if (indexCount === 0) continue;

            const resources = this.getChunkResources(chunk);
            this.writeChunkUniform(resources, chunk, 1.0);

            pass.setBindGroup(1, resources.bindGroup, [0]);

            const shouldUseCompact = !!chunk.useGpuBuffers && !!this.compactShadowPipeline;
            const wantedShadowPipeline = shouldUseCompact ? this.compactShadowPipeline : this.shadowPipeline;
            if (wantedShadowPipeline !== activeShadowPipeline) {
                pass.setPipeline(wantedShadowPipeline);
                activeShadowPipeline = wantedShadowPipeline;
            }
            pass.setVertexBuffer(0, vertexBuffer);
            const shadowUses16Bit = indexBuffer.size < indexCount * 4;
            pass.setIndexBuffer(indexBuffer, shadowUses16Bit ? 'uint16' : 'uint32');
            pass.drawIndexed(indexCount);
        }
    }

    /**
     * Render shadow pass - renders all chunks to shadow map from light's perspective.
     * Additional casters (entities, particles, ropes) can render into the same
     * shadow depth map so their shadows appear on voxel terrain.
     *
     * @param {GPUCommandEncoder} commandEncoder
     * @param {Iterable<VoxelChunk>} chunks
     * @param {Array<{flush: function(GPURenderPassEncoder, Float32Array)}>} [additionalCasters]
     */
    renderShadowPass(commandEncoder, chunks, additionalCasters) {
        if (!this.initialized || !this.shadowsEnabled) return;

        // Stash chunks so flushShadowChunks can iterate them
        this._shadowChunks = chunks;

        const shadowPass = commandEncoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.shadowMapView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        // Render voxel chunks using the reusable flush method
        this.flushShadowChunks(shadowPass, this.lightViewProj);

        // Render additional non-voxel casters (entities, particles, ropes)
        if (additionalCasters) {
            for (let i = 0; i < additionalCasters.length; i++) {
                const caster = additionalCasters[i];
                if (caster && typeof caster.flush === 'function') {
                    caster.flush(shadowPass, this.lightViewProj);
                }
            }
        }

        shadowPass.end();
        this._shadowChunks = null;
    }
    
    /**
     * Render water surfaces to depth texture for caustic calculation
     * @param {GPUCommandEncoder} commandEncoder
     * @param {Iterable<VoxelChunk>} chunks
     */
    renderWaterDepthPass(commandEncoder, chunks) {
        if (!this.initialized || !this.waterCausticsEnabled) return;
        
        const waterDepthPass = commandEncoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.waterMapView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });
        
        // Use shadow pipeline (depth-only) with water bind group
        waterDepthPass.setPipeline(this.shadowPipeline);
        waterDepthPass.setBindGroup(0, this.waterPassBindGroup);
        
        for (const chunk of chunks) {
            // Only render chunks with water
            const waterBuffer = chunk.waterVertexBuffer;
            const waterIndexBuffer = chunk.waterIndexBuffer;
            const waterIndexCount = chunk.waterIndexCount || 0;
            
            if (!waterBuffer || !waterIndexBuffer || waterIndexCount === 0) {
                continue;
            }
            
            const resources = this.getChunkResources(chunk);
            this.writeChunkUniform(resources, chunk, 1.0);
            
            waterDepthPass.setBindGroup(1, resources.bindGroup, [0]);
            waterDepthPass.setVertexBuffer(0, waterBuffer);
            // If buffer can't hold uint32 indices, must be uint16
            const waterDepthUses16Bit = waterIndexBuffer.size < waterIndexCount * 4;
            waterDepthPass.setIndexBuffer(waterIndexBuffer, waterDepthUses16Bit ? 'uint16' : 'uint32');
            waterDepthPass.drawIndexed(waterIndexCount);
        }
        
        waterDepthPass.end();
    }
    
    /**
     * Calculate LOD level (0-9) for a chunk based on distance
     * Returns true 10-level LOD for gradual detail reduction
     * Step sizes: [1, 1, 2, 2, 3, 3, 4, 5, 6, 8]
     * 
     * Uses hysteresis to prevent rapid LOD switching (popping):
     * - Switching to LOWER detail (higher LOD#) requires 10% MORE distance
     * - Switching to HIGHER detail (lower LOD#) requires 10% LESS distance
     * 
     * For out-of-view chunks, only half are allowed to shift LOD per frame
     * (based on chunk position parity) to spread out transitions.
     */
    getChunkLOD(chunk) {
        const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
        const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
        const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
        
        const dx = cx - this.cameraPos[0];
        const dy = cy - this.cameraPos[1];
        const dz = cz - this.cameraPos[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Calculate raw LOD level based on distance
        const ratio = Math.min(dist / this.maxRenderDistanceWorld, 1.0);
        const rawLOD = Math.floor(ratio * (this.lodLevels - 1));
        
        // Apply hysteresis to prevent popping
        const currentLOD = chunk.currentLOD ?? rawLOD;
        const hysteresis = 0.10; // 10% hysteresis band
        
        let newLOD = currentLOD;
        if (rawLOD > currentLOD) {
            // Wanting to decrease detail (increase LOD#) - require extra distance
            const threshold = (currentLOD + 1 + hysteresis) / (this.lodLevels - 1);
            if (ratio >= threshold) {
                newLOD = rawLOD;
            }
        } else if (rawLOD < currentLOD) {
            // Wanting to increase detail (decrease LOD#) - switch earlier
            const threshold = (currentLOD - hysteresis) / (this.lodLevels - 1);
            if (ratio <= threshold) {
                newLOD = rawLOD;
            }
        }
        
        // For out-of-view chunks, only allow LOD shift for half per frame
        // This spreads out LOD transitions to reduce visible popping
        if (newLOD !== currentLOD && this.frustumPlanes) {
            const minX = chunk.cx * CHUNK_SIZE;
            const minY = chunk.cy * CHUNK_SIZE;
            const minZ = chunk.cz * CHUNK_SIZE;
            const maxX = minX + CHUNK_SIZE;
            const maxY = minY + CHUNK_SIZE;
            const maxZ = minZ + CHUNK_SIZE;
            
            const inFrustum = isAABBInFrustum(this.frustumPlanes, minX, minY, minZ, maxX, maxY, maxZ);
            if (!inFrustum) {
                // Chunk is out of view - use position parity + frame to determine if allowed
                const chunkParity = (chunk.cx + chunk.cy + chunk.cz) & 1;
                const frameParity = (this.lodFrameCounter || 0) & 1;
                if (chunkParity !== frameParity) {
                    // Not this chunk's turn to shift LOD - keep current
                    return currentLOD;
                }
            }
        }
        
        // Track LOD transition for potential blending
        if (newLOD !== currentLOD) {
            chunk.lodTransitionStart = performance.now();
            chunk.lodTransitionFrom = currentLOD;
        }
        
        return newLOD;
    }
    
    /**
     * Get the fine-grained LOD level (0-9) for a chunk (same as getChunkLOD now)
     */
    getChunkLODLevel(chunk) {
        return this.getChunkLOD(chunk);
    }

    /**
     * Porcupine culling: check if a chunk is completely surrounded by solid neighbors
     * A chunk with all 6 neighbors being solid/opaque cannot be seen from any direction
     * @param {Object} chunk - The chunk to check
     * @returns {boolean} - True if chunk should be culled (surrounded by solid)
     */
    isChunkSurroundedBySolid(chunk) {
        if (!this.getChunkCallback) return false;
        
        const { cx, cy, cz } = chunk;
        const neighbors = [
            this.getChunkCallback(cx - 1, cy, cz),
            this.getChunkCallback(cx + 1, cy, cz),
            this.getChunkCallback(cx, cy - 1, cz),
            this.getChunkCallback(cx, cy + 1, cz),
            this.getChunkCallback(cx, cy, cz - 1),
            this.getChunkCallback(cx, cy, cz + 1),
        ];
        
        // All 6 neighbors must exist and be fully solid (no exposed faces)
        for (const neighbor of neighbors) {
            if (!neighbor) return false;  // Missing neighbor = not surrounded
            if (!neighbor.isFullySolid) return false;  // Neighbor has air = visible
        }
        
        return true;  // All neighbors are solid - this chunk is buried
    }

    /**
     * Check if a chunk has any opening (non-solid face) on a specific side
     * @param {Object} chunk - The chunk to check
     * @param {number} face - 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
     * @returns {boolean} - True if chunk has opening on that face
     */
    chunkHasOpeningOnFace(chunk, face) {
        // If chunk has any air/transparent voxels, it potentially has openings
        // For fully solid chunks, no openings
        if (chunk.isFullySolid) return false;
        // If chunk has any non-solid voxels, assume it has openings (conservative)
        return chunk.solidCount < (32 * 32 * 32);
    }

    /**
     * Cave portal culling: BFS from camera to find all reachable chunks through openings
     * Chunks not reachable from the camera's position are culled
     * @param {number} camCx - Camera chunk X
     * @param {number} camCy - Camera chunk Y
     * @param {number} camCz - Camera chunk Z
     */
    updateVisibleChunksPortalBFS(camCx, camCy, camCz) {
        if (!this.getChunkCallback) return;
        
        this.visibleChunkKeys.clear();
        
        const visited = new Set();
        const queue = [[camCx, camCy, camCz, 0]];  // [cx, cy, cz, depth]
        const maxDepth = this.portalCullRadius;
        
        // Directions: +X, -X, +Y, -Y, +Z, -Z
        const dirs = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];
        
        while (queue.length > 0) {
            const [cx, cy, cz, depth] = queue.shift();
            const key = `${cx},${cy},${cz}`;
            
            if (visited.has(key)) continue;
            if (depth > maxDepth) continue;
            
            visited.add(key);
            
            const chunk = this.getChunkCallback(cx, cy, cz);
            if (!chunk) continue;
            
            // Mark as visible
            this.visibleChunkKeys.add(key);
            
            // If this chunk is fully solid, don't propagate through it
            // (light/visibility can't pass through solid rock)
            if (chunk.isFullySolid) continue;
            
            // Propagate to neighbors through openings
            for (let i = 0; i < 6; i++) {
                const [dx, dy, dz] = dirs[i];
                const nx = cx + dx;
                const ny = cy + dy;
                const nz = cz + dz;
                const nkey = `${nx},${ny},${nz}`;
                
                if (visited.has(nkey)) continue;
                
                // Check if current chunk has opening on this face
                if (this.chunkHasOpeningOnFace(chunk, i)) {
                    queue.push([nx, ny, nz, depth + 1]);
                }
            }
        }
    }

    /**
     * Project a world point to screen space (pixels). Returns null if behind camera.
     */
    projectToScreen(px, py, pz) {
        if (!this.lastViewProj || !this.screenSize) return null;
        const m = this.lastViewProj;
        const x = px, y = py, z = pz;
        const clipX = m[0]*x + m[4]*y + m[8]*z + m[12];
        const clipY = m[1]*x + m[5]*y + m[9]*z + m[13];
        const clipW = m[3]*x + m[7]*y + m[11]*z + m[15];
        if (clipW <= 0.001) return null;
        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        const sx = (ndcX * 0.5 + 0.5) * this.screenSize[0];
        const sy = ( -ndcY * 0.5 + 0.5) * this.screenSize[1];
        return [sx, sy];
    }

    /**
     * Screen-space LOD based on projected chunk size (with hysteresis).
     */
    getChunkLODScreen(chunk) {
        // Fallback if matrices not ready
        if (!this.useScreenLOD || !this.lastViewProj || !this.screenSize) {
            return this.getChunkLOD(chunk);
        }

        const centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
        const centerY = (chunk.cy + 0.5) * CHUNK_SIZE;
        const centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;

        const half = CHUNK_SIZE * 0.5;
        const offsets = [
            [half, 0, 0],
            [0, half, 0],
            [0, 0, half],
        ];

        const center = this.projectToScreen(centerX, centerY, centerZ);
        if (!center) return this.getChunkLOD(chunk); // behind camera

        let maxRadius = 0;
        for (const o of offsets) {
            const p = this.projectToScreen(centerX + o[0], centerY + o[1], centerZ + o[2]);
            if (!p) continue;
            const dx = p[0] - center[0];
            const dy = p[1] - center[1];
            const r = Math.sqrt(dx*dx + dy*dy);
            if (r > maxRadius) maxRadius = r;
        }

        if (maxRadius === 0) return this.getChunkLOD(chunk);

        // Hysteresis based on current LOD
        const cur = chunk.currentLOD || 0;
        const t0 = this.lodPixelThresholds[0];
        const t1 = this.lodPixelThresholds[1];

        let lod = cur;
        if (cur === 0) {
            if (maxRadius < t0.down) lod = 1;
        } else if (cur === 1) {
            if (maxRadius > t0.up) lod = 0;
            else if (maxRadius < t1.down) lod = 2;
        } else { // cur == 2
            if (maxRadius > t1.up) lod = 1;
        }

        // Stability: require the same requested LOD for N frames before switching
        chunk.lodStable = (chunk.lodStable || 0) + 1;
        if (chunk.requestedLOD !== lod) {
            chunk.requestedLOD = lod;
            chunk.lodStable = 0;
        }
        if (chunk.lodStable >= (this.lodStabilityFrames || 0)) {
            const lastChange = chunk.lodLastChangeTime || -Infinity;
            if ((this.currentTime || 0) - lastChange >= (this.minLODTime || 0)) {
                chunk.currentLOD = lod;
                chunk.lodLastChangeTime = this.currentTime || 0;
                chunk.lodStable = 0;
            }
        }
        return chunk.currentLOD || cur || 0;
    }

    /**
     * Hybrid LOD: combine screen-space and distance, pick the more detailed (lower) LOD.
     */
    getChunkLODHybrid(chunk) {
        const distLOD = this.getChunkLOD(chunk);
        const screenLOD = this.useScreenLOD ? this.getChunkLODScreen(chunk) : distLOD;
        const lod = Math.min(distLOD, screenLOD);
        chunk.currentLOD = lod;
        return lod;
    }
    
    /**
     * Render voxel chunks with LOD support
     * @param {GPURenderPassEncoder} pass 
     * @param {Iterable<VoxelChunk>} chunks 
     */
    render(pass, chunks) {
        if (!this.initialized) return;
        
        // Increment frame counter for staggered LOD transitions
        this.lodFrameCounter++;
        
        // Cave portal culling: BFS from camera to find reachable chunks
        if (this.useCavePortalCulling && this.getChunkCallback && this.cameraPos) {
            const camCx = Math.floor(this.cameraPos[0] / CHUNK_SIZE);
            const camCy = Math.floor(this.cameraPos[1] / CHUNK_SIZE);
            const camCz = Math.floor(this.cameraPos[2] / CHUNK_SIZE);
            this.updateVisibleChunksPortalBFS(camCx, camCy, camCz);
        }
        
        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        let activePipeline = null;
        
        let drawCalls = 0;
        let culled = 0;
        let portalCulled = 0;
        let lodStats = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // 10 LOD levels
        
        for (const chunk of chunks) {
            // Cave portal culling: skip chunks not reachable from camera
            if (this.useCavePortalCulling && this.visibleChunkKeys.size > 0) {
                const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;
                if (!this.visibleChunkKeys.has(key)) {
                    portalCulled++;
                    culled++;
                    continue;
                }
            }
            
            // Distance culling based on configurable maxRenderDistance (spherical around camera)
            if (this.maxRenderDistance > 0 && this.cameraPos) {
                const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
                const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
                const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
                const dx = cx - this.cameraPos[0];
                const dy = cy - this.cameraPos[1];
                const dz = cz - this.cameraPos[2];
                const distSq = dx*dx + dy*dy + dz*dz;
                const maxDistSq = this.maxRenderDistance * this.maxRenderDistance;
                if (distSq > maxDistSq) {
                    culled++;
                    continue;
                }
            }

            // Optional frustum culling (off by default). When disabled, all
            // chunks within radius R render, even behind the camera.
            if (this.useFrustumCulling && this.frustumPlanes) {
                const minX = chunk.cx * CHUNK_SIZE;
                const minY = chunk.cy * CHUNK_SIZE;
                const minZ = chunk.cz * CHUNK_SIZE;
                const maxX = minX + CHUNK_SIZE;
                const maxY = minY + CHUNK_SIZE;
                const maxZ = minZ + CHUNK_SIZE;
                
                if (!isAABBInFrustum(this.frustumPlanes, minX, minY, minZ, maxX, maxY, maxZ)) {
                    culled++;
                    continue;
                }
            }
            
            // Cave culling: skip fully solid chunks that have no open faces
            // These are buried in solid rock and can't be seen
            if (this.useCaveCulling && chunk.visibilityComputed && chunk.isFullySolid) {
                culled++;
                continue;
            }
            
            // Porcupine culling: skip chunks completely surrounded by solid neighbors
            // If all 6 neighbors are fully solid, this chunk cannot be seen from any ray
            if (this.usePorcupineCulling && this.isChunkSurroundedBySolid(chunk)) {
                culled++;
                continue;
            }
            
            // Select LOD level
            let lod = 0;
            let vertexBuffer = chunk.vertexBuffer;
            let indexBuffer = chunk.indexBuffer;
            let indexCount = chunk.indexCount;
            let prevBuffer = null;
            let prevIndex = null;
            let prevCount = 0;
            let activeLodBuffer = null;  // Track LOD buffer for index format
            
            if (this.useLOD) {
                // Get true 10-level LOD (0-9) based on distance
                lod = this.useScreenLOD ? this.getChunkLODScreen(chunk) : this.getChunkLOD(chunk);
                
                // === CASCADED LOD SYSTEM ===
                // Map LOD levels to mesh granularity:
                // LOD 0-1: Full 32³ mesh (base mesh)
                // LOD 2-3: 16³ sub-meshes (8 draw calls max)
                // LOD 4-5: 8³ sub-meshes (64 draw calls max, but most culled)
                // LOD 6-9: Use LOD buffers (decimated meshes)
                
                // Check for cascaded sub-mesh rendering (LOD 2-5)
                if (lod >= 2 && lod <= 5 && chunk.meshGranularity) {
                    // Try sub-mesh rendering based on granularity
                    const subMeshes = lod <= 3 ? chunk.subMeshes16 : chunk.subMeshes8;
                    if (subMeshes && subMeshes.size > 0) {
                        // Render sub-meshes (handled in separate loop below)
                        chunk._useCascadedLOD = true;
                        chunk._cascadedSubMeshes = subMeshes;
                    }
                }
                
                // Try to use LOD buffers for distant chunks (LOD 6-9)
                if (!chunk.useGpuBuffers && lod >= 6 && chunk.lodBuffers) {
                    let foundLOD = lod;
                    while (foundLOD >= 2 && !chunk.lodBuffers[foundLOD]) {
                        foundLOD--;
                    }
                    if (foundLOD >= 2 && chunk.lodBuffers[foundLOD]) {
                        activeLodBuffer = chunk.lodBuffers[foundLOD];
                        vertexBuffer = activeLodBuffer.vertexBuffer;
                        indexBuffer = activeLodBuffer.indexBuffer;
                        indexCount = activeLodBuffer.indexCount;
                        lod = foundLOD;
                    } else {
                        lod = 0;
                    }
                } else if (lod >= 2 && !chunk._useCascadedLOD) {
                    // No cascaded sub-meshes or LOD buffers, fallback to base mesh
                    lod = 0;
                }

                // Handle transition start
                const now = this.currentTime || 0;
                if (chunk.currentLOD === undefined) {
                    chunk.currentLOD = lod;
                    chunk.transitioning = false;
                } else if (lod !== chunk.currentLOD) {
                    chunk.prevLOD = chunk.currentLOD;
                    chunk.currentLOD = lod;
                    chunk.transitionStart = now;
                    chunk.transitionDuration = 0.35;
                    chunk.transitioning = true;
                }

                // If transitioning and prev buffers exist, set them
                if (chunk.transitioning && chunk.prevLOD !== undefined && chunk.lodBuffers && chunk.lodBuffers[chunk.prevLOD]) {
                    const prev = chunk.lodBuffers[chunk.prevLOD];
                    prevBuffer = prev.vertexBuffer;
                    prevIndex = prev.indexBuffer;
                    prevCount = prev.indexCount;
                }

                // Disable cross-fade transitions for performance (snap to new LOD)
                chunk.transitioning = false;
                chunk.prevLOD = undefined;
            }
            
            // === CASCADED SUB-MESH RENDERING ===
            // If using cascaded LOD, render sub-meshes instead of full mesh
            if (chunk._useCascadedLOD && chunk._cascadedSubMeshes) {
                const resources = this.getChunkResources(chunk);
                this.writeChunkUniform(resources, chunk, 1.0);
                chunk._useCascadedLOD = false;
                chunk._cascadedSubMeshes = null;
                lodStats[lod]++;
                continue;
            }
            
            if (!vertexBuffer || !indexBuffer) {
                continue;
            }
            
            // Skip fast-path chunks that need indirect draw (indexCount = -1)
            if (indexCount < 0 || indexCount === undefined) {
                continue;
            }
            
            if (indexCount === 0) {
                continue;
            }
            
            // BATCHED UNIFORMS: Write to batched buffer with dynamic offset
            if (this.useBatchedUniforms && this.batchedBindGroup && drawCalls < this.maxBatchedChunks) {
                // Write uniform data to batched buffer
                const byteOffset = this.writeBatchedChunkUniform(drawCalls, chunk);
                
                // Use dynamic offset with batched bind group
                pass.setBindGroup(1, this.batchedBindGroup, [byteOffset]);
            } else {
                // Fallback to per-chunk uniforms
                // Must pass [0] offset since layout has hasDynamicOffset: true
                const resources = this.getChunkResources(chunk);
                this.writeChunkUniform(resources, chunk, 1.0);
                pass.setBindGroup(1, resources.bindGroup, [0]);
            }

            const shouldUseCompact = !!chunk.useGpuBuffers && !!this.compactPipeline;
            const wantedPipeline = shouldUseCompact ? this.compactPipeline : this.pipeline;
            if (wantedPipeline !== activePipeline) {
                pass.setPipeline(wantedPipeline);
                activePipeline = wantedPipeline;
            }
            pass.setVertexBuffer(0, vertexBuffer);
            // If buffer can't hold uint32 indices (4 bytes each), must be uint16
            const bufferSize = indexBuffer.size;
            const uses16Bit = bufferSize < indexCount * 4;
            const indexFormat = uses16Bit ? 'uint16' : 'uint32';
            pass.setIndexBuffer(indexBuffer, indexFormat);
            pass.drawIndexed(indexCount);
            
            lodStats[lod]++;
            drawCalls++;
        }
        
        // Flush batched uniforms with single writeBuffer call
        if (this.useBatchedUniforms && drawCalls > 0) {
            this.flushBatchedUniforms(drawCalls);
        }
        
        this.visibleChunks = drawCalls;
        this.culledChunks = culled;
        this.lodStats = lodStats;
        
        // Periodic LOD debug logging (every 5 seconds)
        const now = performance.now();
        if (!this._lastLODLog || now - this._lastLODLog > 5000) {
            this._lastLODLog = now;
            const total = lodStats.reduce((a, b) => a + b, 0);
            if (total > 0) {
                const pcts = lodStats.map((c, i) => c > 0 ? `L${i}:${c}` : null).filter(Boolean).join(' ');
                console.log(`[LOD] ${total} chunks: ${pcts} | culled: ${culled}`);
            }
        }
        
        return drawCalls;
    }

    _renderFacePullMeshlets(pass, facePullChunks, commandEncoder, isWater) {
        const chunksArray = Array.isArray(facePullChunks) ? facePullChunks : Array.from(facePullChunks);
        if (chunksArray.length === 0) return 0;

        const pool = isWater ? this._facePullWaterMeshletPool : this._facePullMeshletPool;
        const cull = isWater ? this._facePullWaterMeshletCull : this._facePullMeshletCull;
        const pipeline = isWater ? this.facePullMeshletWaterPipeline : this.facePullMeshletPipeline;

        if (!pool || !cull) return 0;
        if (!pipeline) return 0;

        pool.freeBlocks = [{ offset: 0, size: pool.facesCapacity }];
        pool.allocatedFaces = 0;

        const maxFaces = this.facePullMeshletMaxFaces;
        const meshlets = [];

        for (const chunk of chunksArray) {
            const faceBuffer = isWater ? chunk.waterFaceBuffer : chunk.opaqueFaceBuffer;
            const faceCount = isWater ? chunk.waterFaceCount : chunk.opaqueFaceCount;
            if (!faceBuffer || !faceCount) continue;

            const origin = chunk.chunkOrigin || [chunk.cx * CHUNK_SIZE, chunk.cy * CHUNK_SIZE, chunk.cz * CHUNK_SIZE];

            const chunkKey = typeof chunk.key === 'number' ? (chunk.key >>> 0) : 0;

            const alloc = pool.allocate(faceCount);
            if (!alloc) continue;
            pool.copyFrom(commandEncoder, faceBuffer, 0, alloc, faceCount);

            let remaining = faceCount;
            let cursor = 0;
            while (remaining > 0) {
                const n = Math.min(remaining, maxFaces);
                meshlets.push({
                    aabbMin: [origin[0], origin[1], origin[2]],
                    aabbMax: [origin[0] + CHUNK_SIZE, origin[1] + CHUNK_SIZE, origin[2] + CHUNK_SIZE],
                    firstFace: alloc.offsetFaces + cursor,
                    faceCount: n,
                    chunkKey,
                    materialGroup: 0,
                });
                cursor += n;
                remaining -= n;
            }
        }

        const meshletCount = cull.uploadMeshlets(meshlets);
        if (!meshletCount) return 0;

        if (this.hiZPass?.hiZTexture) {
            cull.setHiZTexture(this.hiZPass.hiZTexture);
        }

        const viewProj = this.lastViewProj || new Float32Array(16);
        const screenWidth = this.screenSize?.[0] || 1920;
        const screenHeight = this.screenSize?.[1] || 1080;
        cull.maxRenderDistance = this.maxRenderDistanceWorld || 0;
        cull.enableFrustumCulling = !!this.useFrustumCulling;
        cull.enableOcclusionCulling = !!(this.hiZPass?.enabled);
        cull.cull(commandEncoder, viewProj, this.cameraPos, screenWidth, screenHeight, meshletCount);

        const bindGroupKey = isWater ? '_facePullWaterMeshletBindGroup' : '_facePullMeshletBindGroup';
        const poolBufKey = isWater ? '_facePullWaterMeshletBindGroupPoolBuffer' : '_facePullMeshletBindGroupPoolBuffer';
        if (!this[bindGroupKey] || this[poolBufKey] !== pool.buffer) {
            this[bindGroupKey] = this.device.createBindGroup({
                layout: this.facePullMeshletBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: cull.meshletInfoBuffer } },
                    { binding: 1, resource: { buffer: cull.visibleIdsBuffer } },
                    { binding: 2, resource: { buffer: pool.buffer } },
                ],
            });
            this[poolBufKey] = pool.buffer;
        }

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        pass.setBindGroup(1, this[bindGroupKey]);

        pass.drawIndirect(cull.drawArgsBuffer, 0);
        return 1;
    }
    
    /**
     * GPU-driven render using indirect draw commands
     * Uploads all chunks to GPU, runs compute culling, then uses drawIndexedIndirect
     * @param {GPURenderPassEncoder} pass 
     * @param {Array<VoxelChunk>} chunks - Must be an array (not iterator)
     * @param {GPUCommandEncoder} commandEncoder - For running culling compute before render
     * @returns {number} - Number of draw calls (from GPU stats)
     */
    renderGpuDriven(pass, chunks, commandEncoder) {
        if (!this.initialized || !this.chunkCullCompute?.initialized) {
            // Fallback to CPU rendering
            return this.render(pass, chunks);
        }
        
        const chunksArray = Array.isArray(chunks) ? chunks : Array.from(chunks);
        if (chunksArray.length === 0) return 0;
        
        // Prepare chunk data for GPU upload
        const chunkData = [];
        const chunkMap = new Map();  // key -> index for looking up results
        
        for (let i = 0; i < chunksArray.length; i++) {
            const chunk = chunksArray[i];
            if (!chunk.vertexBuffer || !chunk.indexBuffer || chunk.indexCount === 0) continue;
            
            const minX = chunk.cx * CHUNK_SIZE;
            const minY = chunk.cy * CHUNK_SIZE;
            const minZ = chunk.cz * CHUNK_SIZE;
            
            chunkData.push({
                aabbMin: [minX, minY, minZ],
                aabbMax: [minX + CHUNK_SIZE, minY + CHUNK_SIZE, minZ + CHUNK_SIZE],
                indexCount: chunk.indexCount,
                vertexOffset: 0,
                indexOffset: 0,
                key: i,
            });
            chunkMap.set(chunk.key, i);
        }
        
        // Upload chunks to GPU
        const uploadedCount = this.chunkCullCompute.uploadChunks(chunkData);
        if (uploadedCount === 0) return 0;
        
        // Run GPU culling
        const viewProj = this.lastViewProj || new Float32Array(16);
        const screenWidth = this.screenSize?.[0] || 1920;
        const screenHeight = this.screenSize?.[1] || 1080;
        
        this.chunkCullCompute.cull(viewProj, this.cameraPos, screenWidth, screenHeight, uploadedCount);
        
        // Now render using standard per-chunk draws but skip CPU culling
        // (GPU already did frustum + occlusion culling)
        this.lodFrameCounter++;

        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        let activePipeline = null;
        
        let drawCalls = 0;
        let lodStats = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        
        for (const chunk of chunksArray) {
            if (!chunk.vertexBuffer || !chunk.indexBuffer || chunk.indexCount === 0) continue;
            
            // Skip CPU culling - GPU already did it
            // Just do LOD selection and draw
            
            let lod = 0;
            let vertexBuffer = chunk.vertexBuffer;
            let indexBuffer = chunk.indexBuffer;
            let indexCount = chunk.indexCount;
            let activeLodBuffer = null;
            
            if (this.useLOD) {
                lod = this.getChunkLOD(chunk);
                if (!chunk.useGpuBuffers && lod >= 2 && chunk.lodBuffers?.[lod]) {
                    activeLodBuffer = chunk.lodBuffers[lod];
                    vertexBuffer = activeLodBuffer.vertexBuffer;
                    indexBuffer = activeLodBuffer.indexBuffer;
                    indexCount = activeLodBuffer.indexCount;
                } else {
                    lod = 0;
                }
            }
            
            // Skip chunks with invalid indexCount (fast path uses indirect draw)
            if (!vertexBuffer || !indexBuffer) continue;
            if (indexCount < 0 || indexCount === undefined || indexCount === 0) continue;
            
            const resources = this.getChunkResources(chunk);
            this.writeChunkUniform(resources, chunk, 1.0);
            pass.setBindGroup(1, resources.bindGroup, [0]);

            const shouldUseCompact = !!chunk.useGpuBuffers && !!this.compactPipeline;
            const wantedPipeline = shouldUseCompact ? this.compactPipeline : this.pipeline;
            if (wantedPipeline !== activePipeline) {
                pass.setPipeline(wantedPipeline);
                activePipeline = wantedPipeline;
            }
            pass.setVertexBuffer(0, vertexBuffer);
            // If buffer can't hold uint32 indices, must be uint16
            const gpuUses16Bit = indexBuffer.size < indexCount * 4;
            pass.setIndexBuffer(indexBuffer, gpuUses16Bit ? 'uint16' : 'uint32');
            pass.drawIndexed(indexCount);
            
            lodStats[lod]++;
            drawCalls++;
        }
        
        this.visibleChunks = drawCalls;
        this.lodStats = lodStats;
        
        return drawCalls;
    }
    
    /**
     * Set ChunkCullCompute reference for GPU-driven rendering
     * @param {ChunkCullCompute} cullCompute 
     */
    setChunkCullCompute(cullCompute) {
        this.chunkCullCompute = cullCompute;
        if (cullCompute?.initialized) {
            this.useGpuCulling = true;
            // Sync LOD thresholds from VoxelRenderer to ChunkCullCompute
            if (this.lodDistances && this.lodDistances.length >= 9) {
                cullCompute.lodDistances = [...this.lodDistances];
            }
            cullCompute.lodLevels = this.lodLevels || 10;
            cullCompute.lodHysteresis = 0.1;  // 10% hysteresis band
            cullCompute.maxRenderDistance = this.maxRenderDistance || 512;
            console.log('[VoxelRenderer] GPU culling + LOD enabled (10 levels)');
        }
    }
    
    /**
     * Full GPU indirect rendering - uses drawIndexedIndirect for maximum GPU efficiency
     * Requires all chunks to be in a unified vertex pool (VertexPool)
     * @param {GPURenderPassEncoder} pass 
     * @param {Array<VoxelChunk>} chunks 
     * @param {VertexPool} vertexPool - Unified vertex pool with all chunk meshes
     * @returns {number} - Draw count
     */
    renderFullyIndirect(pass, chunks, vertexPool) {
        if (!this.initialized || !vertexPool?.initialized) {
            return this.render(pass, chunks);
        }

        if (!this.compactPipeline) {
            return this.render(pass, chunks);
        }
        
        const chunksArray = Array.isArray(chunks) ? chunks : Array.from(chunks);
        if (chunksArray.length === 0) return 0;

        pass.setPipeline(this.compactPipeline);
        pass.setBindGroup(0, this.frameBindGroup);
        
        // Use vertex pool's unified buffers
        pass.setVertexBuffer(0, vertexPool.vertexBuffer);
        pass.setIndexBuffer(vertexPool.indexBuffer, 'uint32');
        
        let drawCalls = 0;
        
        // Draw each chunk using its allocation in the vertex pool
        for (const chunk of chunksArray) {
            if (!chunk.poolAllocation) continue;
            
            const alloc = chunk.poolAllocation;
            if (alloc.indexCount === 0) continue;
            
            // Set per-chunk uniforms
            const resources = this.getChunkResources(chunk);
            this.writeChunkUniform(resources, chunk, 1.0);
            pass.setBindGroup(1, resources.bindGroup, [0]);
            
            // Draw using indirect buffer from pool if available
            if (alloc.indirectOffset !== undefined && vertexPool.indirectBuffer) {
                pass.drawIndexedIndirect(vertexPool.indirectBuffer, alloc.indirectOffset);
            } else {
                // Fallback to direct indexed draw with pool offsets
                pass.drawIndexed(alloc.indexCount, 1, alloc.indexOffset, alloc.vertexOffset, 0);
            }
            
            drawCalls++;
        }
        
        this.visibleChunks = drawCalls;
        return drawCalls;
    }
    
    /**
     * Render chunks using face-pull pipeline (ultra-compressed: 4 bytes/face!)
     * Uses vertex pulling from storage buffer - no vertex/index buffers needed
     * @param {GPURenderPassEncoder} pass 
     * @param {Iterable<Object>} facePullChunks - Chunks with face-pull data from FaceListMesher
     * @returns {number} - Draw count
     */
    renderFacePull(pass, facePullChunks) {
        if (!this.initialized || !this.facePullPipeline) {
            return 0;
        }

        const commandEncoder = arguments.length >= 3 ? arguments[2] : null;
        if (this.useFacePullMeshlets && commandEncoder && this.facePullMeshletPipeline) {
            const meshletDraws = this._renderFacePullMeshlets(pass, facePullChunks, commandEncoder, false);
            if (meshletDraws > 0) return meshletDraws;
        }
        
        const chunksArray = Array.isArray(facePullChunks) ? facePullChunks : Array.from(facePullChunks);
        if (chunksArray.length === 0) {
            return 0;
        }
        
        pass.setPipeline(this.facePullPipeline);
        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        
        let drawCalls = 0;
        
        for (const chunk of chunksArray) {
            if (!chunk.opaqueFaceBuffer || chunk.opaqueFaceCount === 0) {
                continue;
            }
            
            // Frustum culling
            if (this.useFrustumCulling && this.frustumPlanes) {
                const minX = chunk.cx * CHUNK_SIZE;
                const minY = chunk.cy * CHUNK_SIZE;
                const minZ = chunk.cz * CHUNK_SIZE;
                const maxX = minX + CHUNK_SIZE;
                const maxY = minY + CHUNK_SIZE;
                const maxZ = minZ + CHUNK_SIZE;
                
                if (!isAABBInFrustum(this.frustumPlanes, minX, minY, minZ, maxX, maxY, maxZ)) {
                    continue;
                }
            }
            
            // Get or create face-pull bind group for this chunk
            const bindGroup = this._getFacePullBindGroup(chunk);
            if (!bindGroup) continue;
            
            pass.setBindGroup(1, bindGroup);
            
            // LOD for face-pull: render fewer faces based on distance (NO REMESHING!)
            // LOD0: 100%, LOD1-3: 75%, LOD4-6: 50%, LOD7-9: 25%
            let faceCount = chunk.opaqueFaceCount;
            if (this.useLOD && this.cameraPos) {
                const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
                const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
                const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
                const dx = cx - this.cameraPos[0];
                const dy = cy - this.cameraPos[1];
                const dz = cz - this.cameraPos[2];
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const lod = this.useLOD ? this.getChunkLOD({ cx: chunk.cx, cy: chunk.cy, cz: chunk.cz }) : 0;
                
                // Reduce face count for distant chunks (no quality loss for close chunks)
                if (lod >= 7) {
                    faceCount = Math.ceil(faceCount * 0.25);
                } else if (lod >= 4) {
                    faceCount = Math.ceil(faceCount * 0.5);
                } else if (lod >= 1) {
                    faceCount = Math.ceil(faceCount * 0.75);
                }
            }
            
            // draw(vertexCount) - 6 vertices per face, no indices!
            pass.draw(faceCount * 6);
            drawCalls++;
        }
        
        this.visibleChunks = drawCalls;
        return drawCalls;
    }
    
    /**
     * Render water using face-pull pipeline
     * @param {GPURenderPassEncoder} pass 
     * @param {Iterable<Object>} facePullChunks 
     * @returns {number} - Draw count
     */
    renderFacePullWater(pass, facePullChunks) {
        if (!this.initialized || !this.facePullWaterPipeline) {
            return 0;
        }

        const commandEncoder = arguments.length >= 3 ? arguments[2] : null;
        if (this.useFacePullMeshlets && commandEncoder && this.facePullMeshletWaterPipeline) {
            const meshletDraws = this._renderFacePullMeshlets(pass, facePullChunks, commandEncoder, true);
            if (meshletDraws > 0) return meshletDraws;
            // Fallback to non-meshlet path if meshlet rendering returned 0
        }
        
        const chunksArray = Array.isArray(facePullChunks) ? facePullChunks : Array.from(facePullChunks);
        if (chunksArray.length === 0) return 0;
        
        pass.setPipeline(this.facePullWaterPipeline);
        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        
        let drawCalls = 0;
        
        for (const chunk of chunksArray) {
            if (!chunk.waterFaceBuffer || chunk.waterFaceCount === 0) continue;
            
            // Get or create water face-pull bind group
            const bindGroup = this._getWaterFacePullBindGroup(chunk);
            if (!bindGroup) continue;
            
            pass.setBindGroup(1, bindGroup);
            pass.draw(chunk.waterFaceCount * 6);
            drawCalls++;
        }
        
        return drawCalls;
    }
    
    /**
     * Get or create face-pull bind group for a chunk (opaque faces)
     * @private
     */
    _getFacePullBindGroup(chunk) {
        if (!this.facePullBindGroupLayout || !chunk.opaqueFaceBuffer) return null;
        
        const key = chunk.key + '_opaque';
        let resources = this.facePullChunkResources.get(key);
        
        if (!resources || resources.faceBuffer !== chunk.opaqueFaceBuffer) {
            // Create uniform buffer for chunk origin
            const uniformBuffer = this.device.createBuffer({
                label: `FacePull Chunk ${chunk.key} Uniforms`,
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            
            const origin = chunk.chunkOrigin || [chunk.cx * CHUNK_SIZE, chunk.cy * CHUNK_SIZE, chunk.cz * CHUNK_SIZE];
            // Use pre-allocated buffer to avoid allocation
            const originData = this._facePullOriginData;
            originData[0] = origin[0]; originData[1] = origin[1]; originData[2] = origin[2]; originData[3] = 0;
            this.device.queue.writeBuffer(uniformBuffer, 0, originData);
            
            const bindGroup = this.device.createBindGroup({
                layout: this.facePullBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: chunk.opaqueFaceBuffer } },
                ],
            });
            
            // Clean up old resources
            if (resources?.uniformBuffer) {
                resources.uniformBuffer.destroy();
            }
            
            resources = { uniformBuffer, bindGroup, faceBuffer: chunk.opaqueFaceBuffer };
            this.facePullChunkResources.set(key, resources);
        }
        
        return resources.bindGroup;
    }
    
    /**
     * Get or create face-pull bind group for water faces
     * @private
     */
    _getWaterFacePullBindGroup(chunk) {
        if (!this.facePullBindGroupLayout || !chunk.waterFaceBuffer) return null;
        
        const key = chunk.key + '_water';
        let resources = this.facePullChunkResources.get(key);
        
        if (!resources || resources.faceBuffer !== chunk.waterFaceBuffer) {
            const uniformBuffer = this.device.createBuffer({
                label: `FacePull Water ${chunk.key} Uniforms`,
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            
            const origin = chunk.chunkOrigin || [chunk.cx * CHUNK_SIZE, chunk.cy * CHUNK_SIZE, chunk.cz * CHUNK_SIZE];
            // Use pre-allocated buffer to avoid allocation
            const originData = this._facePullOriginData;
            originData[0] = origin[0]; originData[1] = origin[1]; originData[2] = origin[2]; originData[3] = 0;
            this.device.queue.writeBuffer(uniformBuffer, 0, originData);
            
            const bindGroup = this.device.createBindGroup({
                layout: this.facePullBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: chunk.waterFaceBuffer } },
                ],
            });
            
            if (resources?.uniformBuffer) {
                resources.uniformBuffer.destroy();
            }
            
            resources = { uniformBuffer, bindGroup, faceBuffer: chunk.waterFaceBuffer };
            this.facePullChunkResources.set(key, resources);
        }
        
        return resources.bindGroup;
    }
    
    /**
     * Release face-pull resources for a chunk
     * @param {string} chunkKey 
     */
    releaseFacePullResources(chunkKey) {
        const opaqueKey = chunkKey + '_opaque';
        const waterKey = chunkKey + '_water';
        
        const opaque = this.facePullChunkResources.get(opaqueKey);
        if (opaque?.uniformBuffer) {
            opaque.uniformBuffer.destroy();
            this.facePullChunkResources.delete(opaqueKey);
        }
        
        const water = this.facePullChunkResources.get(waterKey);
        if (water?.uniformBuffer) {
            water.uniformBuffer.destroy();
            this.facePullChunkResources.delete(waterKey);
        }
    }
    
    /**
     * Render water/transparent geometry (call AFTER render())
     * Uses separate pipeline with no depth write for proper transparency
     * @param {GPURenderPassEncoder} pass 
     * @param {Iterable<VoxelChunk>} chunks 
     */
    renderWater(pass, chunks) {
        if (!this.initialized) return;
        
        pass.setBindGroup(0, this.frameBindGroup);

        if (!this.materialBindGroup) {
            this._updateMaterialBindGroup();
        }
        pass.setBindGroup(2, this.materialBindGroup);
        let activePipeline = null;
        
        let waterDrawCalls = 0;
        let totalWaterIndices = 0;
        
        for (const chunk of chunks) {
            const useCompactWater = !!chunk.useGpuBuffers && !!this.compactWaterPipeline;
            if (useCompactWater) {
                if (!chunk.gpuHasWater) {
                    continue;
                }
                if (!chunk.vertexBuffer || !chunk.indexBuffer || chunk.indexCount === 0) {
                    continue;
                }
            } else {
                // Skip chunks without water
                if (!chunk.waterVertexBuffer || !chunk.waterIndexBuffer || chunk.waterIndexCount === 0) {
                    continue;
                }
            }
            
            // Distance culling (same as opaque)
            if (this.maxRenderDistance > 0 && this.cameraPos) {
                const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
                const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
                const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
                const dx = cx - this.cameraPos[0];
                const dy = cy - this.cameraPos[1];
                const dz = cz - this.cameraPos[2];
                const distSq = dx*dx + dy*dy + dz*dz;
                const maxDistSq = this.maxRenderDistance * this.maxRenderDistance;
                if (distSq > maxDistSq) {
                    continue;
                }
            }
            
            // Optional frustum culling
            if (this.useFrustumCulling && this.frustumPlanes) {
                const minX = chunk.cx * CHUNK_SIZE;
                const minY = chunk.cy * CHUNK_SIZE;
                const minZ = chunk.cz * CHUNK_SIZE;
                const maxX = minX + CHUNK_SIZE;
                const maxY = minY + CHUNK_SIZE;
                const maxZ = minZ + CHUNK_SIZE;
                
                if (!isAABBInFrustum(this.frustumPlanes, minX, minY, minZ, maxX, maxY, maxZ)) {
                    continue;
                }
            }
            
            const resources = this.getChunkResources(chunk);
            this.writeChunkUniform(resources, chunk, 1.0);
            
            pass.setBindGroup(1, resources.bindGroup, [0]);
            const wantedPipeline = useCompactWater ? this.compactWaterPipeline : this.waterPipeline;
            if (wantedPipeline !== activePipeline) {
                pass.setPipeline(wantedPipeline);
                activePipeline = wantedPipeline;
            }

            if (useCompactWater) {
                pass.setVertexBuffer(0, chunk.vertexBuffer);
                const waterUses16Bit = chunk.indexBuffer.size < chunk.indexCount * 4;
                pass.setIndexBuffer(chunk.indexBuffer, waterUses16Bit ? 'uint16' : 'uint32');
                pass.drawIndexed(chunk.indexCount);
                totalWaterIndices += chunk.indexCount;
            } else {
                pass.setVertexBuffer(0, chunk.waterVertexBuffer);
                // If buffer can't hold uint32 indices, must be uint16
                const waterUses16Bit = chunk.waterIndexBuffer.size < chunk.waterIndexCount * 4;
                pass.setIndexBuffer(chunk.waterIndexBuffer, waterUses16Bit ? 'uint16' : 'uint32');
                pass.drawIndexed(chunk.waterIndexCount);
                totalWaterIndices += chunk.waterIndexCount;
            }
            
            waterDrawCalls++;
        }
        
        // Debug: log water rendering stats (every 60 frames)
        if (!this._waterLogFrame) this._waterLogFrame = 0;
        this._waterLogFrame++;
        if (this._waterLogFrame % 300 === 1 && waterDrawCalls > 0) {
            console.log(`[Water] Rendered ${waterDrawCalls} chunks, ${totalWaterIndices} indices`);
        }
        
        return waterDrawCalls;
    }
    
    /**
     * Load configuration from engine.cfg sections
     * @param {Object} cfg - Config sections (chunk_distances, chunk_culling, chunk_lod)
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        // Distances
        if (cfg.chunk_distances) {
            this.renderDistance = parseInt(cfg.chunk_distances.render_distance) || 12;
            this.lod1Distance = parseInt(cfg.chunk_distances.lod1_distance) || 6;
            this.lod2Distance = parseInt(cfg.chunk_distances.lod2_distance) || 10;
            this.lod3Distance = parseInt(cfg.chunk_distances.lod3_distance) || 14;
        }
        
        // Hardcoded LOD radius for consistency (16 chunks = 512 units)
        this.updateLODDistances(16);
        
        // Culling
        if (cfg.chunk_culling) {
            this.frustumCulling = cfg.chunk_culling.frustum_culling !== false;
            this.occlusionCulling = cfg.chunk_culling.occlusion_culling !== false;
            this.backfaceCulling = cfg.chunk_culling.backface_culling !== false;
        }
        
        // LOD
        if (cfg.chunk_lod) {
            this.lodEnabled = cfg.chunk_lod.enabled !== false;
            this.useLOD = this.lodEnabled;
            this.lodLevels = 10;  // Hardcoded: always use 10 LOD levels
            this.geomorphing = cfg.chunk_lod.geomorphing !== false;
        }
        
        // Mesh mode (from world.cfg [mesh_mode])
        if (cfg.mesh_mode) {
            this.meshAlgorithm = cfg.mesh_mode.algorithm || 'marching_cubes';
            this.isolevel = parseFloat(cfg.mesh_mode.isolevel) || 0.0;
            this.smoothingPasses = parseInt(cfg.mesh_mode.smoothing_passes) || 1;
            this.sharpFeatureAngle = parseFloat(cfg.mesh_mode.sharp_feature_angle) || 35;
        }
        
        // Terrain shading (from world.cfg [terrain_shading])
        if (cfg.terrain_shading) {
            this.terrainShading = {
                triplanarEnabled: cfg.terrain_shading.triplanar_enabled !== false,
                triplanarScale: parseFloat(cfg.terrain_shading.triplanar_scale) || 0.1,
                triplanarSharpness: parseFloat(cfg.terrain_shading.triplanar_sharpness) || 4.0,
                slopeBlendEnabled: cfg.terrain_shading.slope_blend_enabled !== false,
                grassSlopeMax: parseFloat(cfg.terrain_shading.grass_slope_max) || 0.3,
                dirtSlopeMax: parseFloat(cfg.terrain_shading.dirt_slope_max) || 0.6,
                rockSlopeMin: parseFloat(cfg.terrain_shading.rock_slope_min) || 0.6,
                heightBlendEnabled: cfg.terrain_shading.height_blend_enabled !== false,
                sandHeightMax: parseFloat(cfg.terrain_shading.sand_height_max) || 5,
                snowHeightMin: parseFloat(cfg.terrain_shading.snow_height_min) || 80,
                peakRockHeight: parseFloat(cfg.terrain_shading.peak_rock_height) || 100,
                biomeColorsEnabled: cfg.terrain_shading.biome_colors_enabled !== false,
                biomeBlendSharpness: parseFloat(cfg.terrain_shading.biome_blend_sharpness) || 1.0,
            };
        }
        
        // Ambient occlusion (from world.cfg [ambient_occlusion])
        if (cfg.ambient_occlusion) {
            this.aoSettings = {
                mode: cfg.ambient_occlusion.ao_mode || 'vertex',
                vertexIntensity: parseFloat(cfg.ambient_occlusion.vertex_ao_intensity) || 0.8,
                worldRadius: parseFloat(cfg.ambient_occlusion.world_ao_radius) || 2.0,
                worldSamples: parseInt(cfg.ambient_occlusion.world_ao_samples) || 8,
                edgeDarkening: parseFloat(cfg.ambient_occlusion.edge_darkening) || 0.08,
            };
        }
        
        // Procedural detail (from world.cfg [procedural_detail])
        if (cfg.procedural_detail) {
            this.proceduralDetail = {
                noiseEnabled: cfg.procedural_detail.noise_enabled !== false,
                noiseIntensity: parseFloat(cfg.procedural_detail.noise_intensity) || 0.2,
                fineDetailIntensity: parseFloat(cfg.procedural_detail.fine_detail_intensity) || 0.1,
                fbmOctaves: parseInt(cfg.procedural_detail.fbm_octaves) || 4,
                fbmPersistence: parseFloat(cfg.procedural_detail.fbm_persistence) || 0.5,
                fbmLacunarity: parseFloat(cfg.procedural_detail.fbm_lacunarity) || 2.0,
            };
        }
    }
    
    /**
     * Update LOD distance thresholds based on render distance
     * 10-level gradual LOD system (0-9), each level is 10% of render distance
     * Mapped to 3 mesh LODs: 0-3→mesh0, 4-6→mesh1, 7-9→mesh2
     * @param {number} renderDistanceChunks - Render distance in chunks
     */
    updateLODDistances(renderDistanceChunks) {
        const chunkSize = 32;  // CHUNK_SIZE
        const maxDist = renderDistanceChunks * chunkSize;
        
        this.renderDistance = renderDistanceChunks;
        this.maxRenderDistanceWorld = maxDist;
        this.maxRenderDistance = maxDist;
        
        // Generate 9 distance thresholds for 10 LOD levels (each 10% of render distance)
        this.lodDistances = [];
        for (let i = 1; i < this.lodLevels; i++) {
            this.lodDistances.push(Math.floor(maxDist * (i / this.lodLevels)));
        }
        
        console.log(`[VoxelRenderer] 10-level LOD system: render=${maxDist}u, thresholds=[${this.lodDistances.slice(0,5).join(', ')}...]`);
    }
    
    /**
     * Cleanup
     */
    destroy() {
        for (const resources of this.chunkResources.values()) {
            resources.uniformBuffer.destroy();
        }
        this.chunkResources.clear();
        
        // Cleanup face-pull resources
        for (const resources of this.facePullChunkResources.values()) {
            resources.uniformBuffer?.destroy();
        }
        this.facePullChunkResources.clear();

        this.materialBindGroup = null;

        this._fallbackMaterialTextures?.baseColor?.destroy?.();
        this._fallbackMaterialTextures?.normal?.destroy?.();
        this._fallbackMaterialTextures?.orm?.destroy?.();
        this._fallbackMaterialTextures?.height?.destroy?.();
        this._fallbackMaterialTextures = null;
        this._fallbackMaterialSampler = null;

        if (this.frameUniformBuffer) {
            this.frameUniformBuffer.destroy();
        }
        
        this.initialized = false;
    }
    
    /**
     * Calculate total GPU memory usage (buffers only, not textures)
     * @param {Map|Object} chunks - Chunk collection to measure
     * @returns {number} Total bytes used by GPU buffers
     */
    getGpuMemoryUsage(chunks) {
        let totalBytes = 0;
        
        // Frame uniform buffer
        if (this.frameUniformBuffer) {
            totalBytes += FRAME_UNIFORMS_SIZE;
        }
        
        // Shadow map texture (depth only)
        if (this.shadowsEnabled) {
            totalBytes += SHADOW_MAP_SIZE * SHADOW_MAP_SIZE * 4; // depth32float
        }
        
        // Per-chunk buffers
        if (!chunks) return totalBytes;
        const chunkArray = chunks instanceof Map ? Array.from(chunks.values()) : Object.values(chunks);
        for (const chunk of chunkArray) {
            if (!chunk) continue; // Skip null/undefined chunks
            
            // Face-pull buffers (ultra-compressed: 4 bytes/face)
            if (chunk.opaqueFaceBuffer?.size) totalBytes += chunk.opaqueFaceBuffer.size;
            if (chunk.waterFaceBuffer?.size) totalBytes += chunk.waterFaceBuffer.size;
            
            // Main vertex/index buffers
            if (chunk.vertexBuffer?.size) totalBytes += chunk.vertexBuffer.size;
            if (chunk.indexBuffer?.size) totalBytes += chunk.indexBuffer.size;
            
            // Water buffers
            if (chunk.waterVertexBuffer?.size) totalBytes += chunk.waterVertexBuffer.size;
            if (chunk.waterIndexBuffer?.size) totalBytes += chunk.waterIndexBuffer.size;
            
            // LOD buffers
            if (chunk.lodBuffers) {
                for (const lod of Object.values(chunk.lodBuffers)) {
                    if (lod?.vertexBuffer?.size) totalBytes += lod.vertexBuffer.size;
                    if (lod?.indexBuffer?.size) totalBytes += lod.indexBuffer.size;
                }
            }
        }
        
        return totalBytes;
    }
}

export default VoxelRenderer;
