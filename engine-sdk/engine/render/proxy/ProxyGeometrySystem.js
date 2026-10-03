// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyGeometrySystem — Main Orchestrator
 *
 * Decouples visual complexity from geometric complexity using the Ray Portal
 * proxy technique adapted from Blender Cycles + 8 researched engine approaches.
 *
 * Architecture:
 *   1. registerTarget(assetId, mesh, material)
 *      → Builds BLAS (BVH via BVHAccel), bakes SDF, bakes Octahedral atlas
 *   2. addInstance(assetId, worldMatrix, mode)
 *      → Adds to instance buffer + TLAS
 *   3. update(fps, cameraPos, encoder)
 *      → Billboard align compute, FPS-driven tier selection, TLAS refit
 *   4. render(encoder, gbuffer, hdrTarget)
 *      → ProxyMaskPass → ProxyShadePass
 *
 * Quality tiers (auto-selected by FPS):
 *   ULTRA  (>55 FPS) — TLAS/BLAS per-pixel ray portal
 *   HIGH   (>40 FPS) — SDF cone march
 *   MED    (>28 FPS) — True impostor (height field billboard)
 *   LOW    (  <28  ) — Octahedral impostor atlas (baked)
 *
 * Public API:
 *   registerTarget(assetId, positions, indices, uvs, material)
 *   addInstance(assetId, worldMatrix, mode)        → instanceId
 *   removeInstance(instanceId)
 *   updateInstanceTransform(instanceId, worldMatrix)
 *   setQualityMode('auto' | 'ultra' | 'high' | 'med' | 'low')
 *   update(fps, cameraPos, commandEncoder)
 *   render(commandEncoder, gbufferTargets, hdrTarget)
 *   getStats()
 *   destroy()
 */

import { initVGPU }             from '../../core/gpu/VirtualGPU.js';
import { BVHBuilder }           from '../../core/math/BVHAccel.js';
import { TLASBuilder }          from './TLASBuilder.js';
import { ProxyBillboardAlign }  from './ProxyBillboardAlign.js';
import { ProxyOctahedralCache } from './ProxyOctahedralCache.js';
import { ProxySDF }             from './ProxySDF.js';
import { ProxyMaskPass, PROXY_TIER } from './ProxyMaskPass.js';
import { ProxyShadePass }       from './ProxyShadePass.js';
import { ProxyGBufferPass }     from './ProxyGBufferPass.js';
import tlasRefitWGSL            from '../../render/shaders/modules/proxy/tlas_refit.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export { PROXY_TIER } from './ProxyMaskPass.js';

export const PROXY_MODE = Object.freeze({
    BOX      : 0,
    BILLBOARD: 1,
});

// GPU instance buffer layout — 96 bytes per instance
const INSTANCE_STRIDE    = 96;
const INITIAL_CAPACITY   = 256;
const GROWTH_FACTOR      = 2;

// Reusable CPU-side scratch buffers (hot path)
const _instanceUpload = new Float32Array(INSTANCE_STRIDE / 4);
const _instanceU32    = new Uint32Array(_instanceUpload.buffer);

// ============================================================================
// FPS Smoothing
// ============================================================================

class FPSMonitor {
    constructor() {
        this._samples   = new Float32Array(30);
        this._head      = 0;
        this._filled    = false;
        this._lastTime  = performance.now();
    }

    tick() {
        const now  = performance.now();
        const dt   = now - this._lastTime;
        this._lastTime = now;
        const fps  = dt > 0 ? 1000 / dt : 60;
        this._samples[this._head] = fps;
        this._head = (this._head + 1) % this._samples.length;
        if (this._head === 0) this._filled = true;
        const len = this._filled ? this._samples.length : this._head;
        let sum = 0;
        for (let i = 0; i < len; i++) sum += this._samples[i];
        return sum / len;
    }
}

// ============================================================================
// Target Asset Registry Entry
// ============================================================================

class ProxyAsset {
    constructor(assetId) {
        this.id          = assetId;
        this.bvh         = null;   // BVH object from BVHBuilder
        this.blasBuffer  = null;   // Serialized BVH GPU buffer
        this.blasOffset  = 0;      // Offset in shared BLAS buffer (future: pool)
        this.halfExtents = [1, 1, 1];
        this.material    = null;   // { albedoTexture, normalTexture, roughMetTexture, sampler }
        this.sdfBaked    = false;
        this.octBaked    = false;
    }
}

// ============================================================================
// ProxyGeometrySystem
// ============================================================================

export class ProxyGeometrySystem {
    /**
     * @param {GPUDevice} device
     * @param {number}    screenWidth
     * @param {number}    screenHeight
     */
    constructor(device, screenWidth, screenHeight) {
        this.vgpu   = initVGPU(device);
        this.device = device;
        this.width  = screenWidth;
        this.height = screenHeight;

        /** @type {Map<number, ProxyAsset>} */
        this._assets   = new Map();

        /** @type {Array<{id:number, assetId:number, worldMat:Float32Array, mode:number, tlasInstanceId:number}>} */
        this._instances    = [];
        this._nextInstId   = 1; // 0 = no proxy in GBuffer

        this._instanceBuffer   = null;
        this._instanceCapacity = 0;
        this._instanceCount    = 0;

        // Sub-systems
        this._tlas      = new TLASBuilder(device);
        this._sdf       = new ProxySDF(device);
        this._octa      = new ProxyOctahedralCache(device);
        this._billboard = null; // created after instance buffer exists
        this._gbufferPass = new ProxyGBufferPass(device, 'depth24plus', screenWidth, screenHeight);
        this._maskPass   = new ProxyMaskPass(device, screenWidth, screenHeight);
        this._shadePass  = new ProxyShadePass(device, screenWidth, screenHeight);

        // FPS monitoring
        this._fpsMonitor   = new FPSMonitor();
        this._qualityMode  = 'auto';

        // GPU-only TLAS refit compute shader
        this._tlasRefitModule = device.createShaderModule({ code: tlasRefitWGSL });
        this._tlasRefitBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ]
        });
        this._tlasRefitPipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this._tlasRefitBindGroupLayout] }),
            compute: { module: this._tlasRefitModule, entryPoint: 'main' }
        });
        this._assetHalfExtentsBuffer = null;

        // Stats
        this.stats = {
            instanceCount    : 0,
            targetAssetCount : 0,
            currentTier      : PROXY_TIER.LOW,
            previousTier     : PROXY_TIER.LOW,
            tierChanged      : false,
            proxyTriangles   : 0,
            savedTriangles   : 0,
        };

        this._initInstanceBuffer(INITIAL_CAPACITY);
        this._billboard = new ProxyBillboardAlign(device, this._instanceBuffer);

        // Shared fallback textures (1×1 neutral)
        this._fallbackSDF      = null;
        this._fallbackOctAtlas = null;
        this._initFallbackTextures();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Register a target asset for proxy rendering.
     * Builds BLAS (BVH), SDF, and Octahedral atlas.
     *
     * @param {number}       assetId    Unique ID chosen by caller
     * @param {Float32Array} positions  Flat [x,y,z,...] vertex positions
     * @param {Uint32Array}  indices    Triangle index buffer
     * @param {Float32Array} uvs        Flat [u,v,...] UVs
     * @param {object}       material   { albedoTexture, normalTexture, roughMetTexture, sampler }
     * @param {object}       opts       { highResSDF: bool, octaFrames: number }
     */
    async registerTarget(assetId, positions, indices, uvs, material, opts = {}) {
        if (this._assets.has(assetId)) {
            console.warn(`[ProxyGeometrySystem] Asset ${assetId} already registered; re-registering.`);
            this._assets.get(assetId).material = material;
            this._sdf.markDirty(assetId);
            this._octa.markDirty(assetId);
        }

        const asset       = new ProxyAsset(assetId);
        asset.material    = material;

        // Compute half-extents from positions
        let maxX = 0, maxY = 0, maxZ = 0;
        for (let i = 0; i < positions.length; i += 3) {
            maxX = Math.max(maxX, Math.abs(positions[i]));
            maxY = Math.max(maxY, Math.abs(positions[i+1]));
            maxZ = Math.max(maxZ, Math.abs(positions[i+2]));
        }
        asset.halfExtents = [maxX, maxY, maxZ];

        // Build BVH (BLAS) - skip for GPU-only mode
        if (!this._gpuOnlyMode) {
            try {
                const bvhBuilder = new BVHBuilder();
                asset.bvh = bvhBuilder.build(positions, indices);
            } catch (e) {
                console.warn(`[ProxyGeometrySystem] BVH build failed for asset ${assetId}:`, e);
            }
        }

        this._assets.set(assetId, asset);
        this.stats.targetAssetCount = this._assets.size;

        // Async baking (non-blocking)
        this._sdf.register(assetId, positions, indices, opts.highResSDF ?? false);
        this._octa.register(assetId);

        this._sdf.bakeAsync(assetId).catch(e => {
            console.warn(`[ProxyGeometrySystem] SDF bake error for asset ${assetId}:`, e);
        });

        console.log(`[ProxyGeometrySystem] Registered asset ${assetId} | halfExtents=[${asset.halfExtents.map(v => v.toFixed(2)).join(',')}]`);
    }

    /**
     * Add a proxy instance for a registered asset.
     *
     * @param {number}       assetId
     * @param {Float32Array} worldMatrix  Column-major 4×4 world transform
     * @param {number}       mode         PROXY_MODE.BOX | PROXY_MODE.BILLBOARD
     * @returns {number} instanceId (for later removeInstance / updateTransform)
     */
    addInstance(assetId, worldMatrix, mode = PROXY_MODE.BOX) {
        const asset = this._assets.get(assetId);
        if (!asset) {
            console.warn(`[ProxyGeometrySystem] addInstance: asset ${assetId} not registered.`);
            return -1;
        }

        // Enforce identity scale (per Blender constraint: scale must be applied in Edit Mode)
        const mat = _normalizeScale(worldMatrix);

        const id = this._nextInstId++;

        // World-space AABB for TLAS
        const [hx, hy, hz] = asset.halfExtents;
        const { aabbMin, aabbMax } = _worldAABB(mat, hx, hy, hz);

        const tlasId = this._tlas.addInstance(asset.blasOffset, mat, aabbMin, aabbMax);

        this._instances.push({ id, assetId, worldMat: new Float32Array(mat), mode, tlasInstanceId: tlasId });

        // Grow GPU buffer if needed
        if (this._instanceCount >= this._instanceCapacity) {
            this._growInstanceBuffer();
        }

        // Upload to GPU instance buffer
        const idx = this._instanceCount;
        this._uploadInstance(idx, mat, assetId, mode, asset.halfExtents);
        this._instanceCount++;

        this.stats.instanceCount    = this._instanceCount;
        this.stats.proxyTriangles  += 12; // 6-face cube = 12 tris
        this.stats.savedTriangles  += this._estimateAssetTriangles(asset);

        return id;
    }

    /**
     * Remove a proxy instance.
     * @param {number} instanceId
     */
    removeInstance(instanceId) {
        const idx = this._instances.findIndex(i => i.id === instanceId);
        if (idx === -1) return;
        const inst = this._instances[idx];
        this._tlas.removeInstance(inst.tlasInstanceId);
        this._instances.splice(idx, 1);
        this._instanceCount--;
        this.stats.instanceCount = this._instanceCount;
        this._rebuildInstanceBuffer();
    }

    /**
     * Update the world transform of an existing proxy instance.
     * @param {number}       instanceId
     * @param {Float32Array} worldMatrix
     */
    updateInstanceTransform(instanceId, worldMatrix) {
        const rec = this._instances.find(i => i.id === instanceId);
        if (!rec) return;
        const mat   = _normalizeScale(worldMatrix);
        rec.worldMat = new Float32Array(mat);
        const asset  = this._assets.get(rec.assetId);
        if (!asset) return;
        const { aabbMin, aabbMax } = _worldAABB(mat, ...asset.halfExtents);
        this._tlas.updateTransform(rec.tlasInstanceId, mat, aabbMin, aabbMax);
        // Find GPU slot and re-upload
        const gpuIdx = this._instances.indexOf(rec);
        if (gpuIdx >= 0) {
            this._uploadInstance(gpuIdx, mat, rec.assetId, rec.mode, asset.halfExtents);
        }
    }

    /**
     * Set quality mode.
     * @param {'auto'|'ultra'|'high'|'med'|'low'} mode
     */
    setQualityMode(mode) {
        this._qualityMode = mode;
        if (mode !== 'auto') {
            const tierMap = { ultra: PROXY_TIER.ULTRA, high: PROXY_TIER.HIGH, med: PROXY_TIER.MED, low: PROXY_TIER.LOW };
            const changed = this._maskPass.setTier(tierMap[mode] ?? PROXY_TIER.LOW);
            this.stats.previousTier = this._maskPass.lastTier;
            this.stats.currentTier = this._maskPass.currentTier;
            this.stats.tierChanged = changed;
        }
    }

    /**
     * Per-frame update. Call once per frame.
     * @param {number}            fps           Smoothed FPS (pass your engine FPS here)
     * @param {number[]}          cameraPos     [x, y, z] world position
     * @param {GPUCommandEncoder} encoder       Reuse the frame's command encoder
     */
    update(fps, cameraPos, encoder) {
        if (this._instanceCount === 0) return;

        // Auto quality tier from FPS
        if (this._qualityMode === 'auto') {
            const smoothFPS = this._fpsMonitor.tick();
            const changed = this._maskPass.updateTier(smoothFPS);
            this.stats.previousTier = this._maskPass.lastTier;
            this.stats.currentTier = this._maskPass.currentTier;
            this.stats.tierChanged = changed;
        }

        // GPU-only mode: run TLAS refit compute shader
        if (this._gpuOnlyMode && this._assetHalfExtentsBuffer) {
            const refitBG = this.device.createBindGroup({
                layout: this._tlasRefitBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this._instanceBuffer } },
                    { binding: 1, resource: { buffer: this._tlas.getTLASBuffer() } },
                    { binding: 2, resource: { buffer: this._assetHalfExtentsBuffer } },
                ]
            });
            const refitPass = encoder.beginComputePass();
            refitPass.setPipeline(this._tlasRefitPipeline);
            refitPass.setBindGroup(0, refitBG);
            refitPass.dispatchWorkgroups(Math.ceil(this._instanceCount / 64));
            refitPass.end();
        } else {
            // CPU mode: rebuild TLAS if instances changed
            this._tlas.commit();
        }

        // Billboard alignment compute (only affects BILLBOARD mode instances)
        const hasBillboards = this._instances.some(i => i.mode === PROXY_MODE.BILLBOARD);
        if (hasBillboards) {
            this._billboard.execute(encoder, cameraPos, this._instanceCount);
        }
    }

    /**
     * Execute all proxy render passes. Insert into the frame's render graph
     * AFTER the GBuffer pass and BEFORE the tonemap pass.
     *
     * @param {GPUCommandEncoder} encoder
     * @param {object}            gbuffer    — { proxyIdTexture, depthTexture }
     * @param {object}            hdrTarget  — { texture: GPUTexture, view: GPUTextureView }
     * @param {object}            sceneData  — { invViewProj, cameraPos, lightingBuffer }
     */
    render(encoder, gbuffer, hdrTarget, sceneData) {
        if (this._instanceCount === 0) return;

        // ── ProxyGBufferPass — stamp instance IDs ─────────────────────────
        const sceneDepthView = gbuffer.depthView ?? gbuffer.depthTexture?.createView();
        this._gbufferPass.execute(
            encoder,
            this._instanceBuffer,
            this._instanceCount,
            sceneData.viewProj ?? sceneData.invViewProj, // prefer forward VP
            sceneDepthView,
        );

        const proxyIdTexture = this._gbufferPass.getProxyIdTexture();
        const { depthTexture } = gbuffer;
        const { invViewProj, cameraPos, lightingBuffer } = sceneData;

        // Use fallbacks if SDF / oct atlas not yet baked
        const sdfView  = this._getAnySdfView()  ?? this._fallbackSDF.createView({ dimension: '3d' });
        const octView  = this._getAnyOctView()  ?? this._fallbackOctAtlas.createView();

        // Empty BLAS/TLAS buffer stubs (filled properly in Phase 4)
        const blasStub     = this._tlas.getTLASBuffer(); // reuse as no-op
        const blasTriStub  = this._tlas.getInstanceBuffer();

        // ── ProxyMaskPass ──────────────────────────────────────────────────
        this._maskPass.execute(encoder, {
            proxyIdTexture,
            depthTexture,
            instanceBuffer     : this._instanceBuffer,
            tlasBuffer         : this._tlas.getTLASBuffer(),
            tlasInstanceBuffer : this._tlas.getInstanceBuffer(),
            blasBuffer         : blasStub,
            blasTriBuffer      : blasTriStub,
            sdfTextureView     : sdfView,
            sdfSampler         : this._sdf.getSampler(),
            octAtlasView       : octView,
            octSampler         : this._octa.getSampler(),
            invViewProj,
            cameraPos,
            maxBounces         : this._computeMaxBounces(),
            sdfScale           : this._getAnySdfScale() ?? 1.0,
            octAtlasFrames     : this._octa.getAtlasFrameCount(),
        });

        // ── ProxyShadePass ─────────────────────────────────────────────────
        const mat = this._getAnyMaterial();
        if (mat) {
            this._shadePass.execute(encoder, {
                hitMaskView    : this._maskPass.getHitMaskView(),
                hitPosView     : this._maskPass.getHitPosView(),
                hitNormView    : this._maskPass.getHitNormView(),
                hitUVView      : this._maskPass.getHitUVView(),
                matSampler     : mat.sampler,
                albedoView     : mat.albedoTexture.createView(),
                normalMapView  : mat.normalTexture.createView(),
                roughMetView   : mat.roughMetTexture.createView(),
                lightingBuffer,
                hdrView        : hdrTarget.view,
                cameraPos,
                roughnessBase  : 1.0,
                metallicBase   : 1.0,
            });
        }
    }

    getStats() { return { ...this.stats }; }

    consumeTierChanged() {
        const changed = this.stats.tierChanged || this._maskPass.consumeTierChanged();
        this.stats.tierChanged = false;
        return changed;
    }

    resize(width, height) {
        this.width  = width;
        this.height = height;
        this._gbufferPass.resize(width, height);
        this._maskPass.resize(width, height);
        this._shadePass.resize(width, height);
    }

    destroy() {
        this._instanceBuffer?.destroy();
        this._tlas.destroy();
        this._sdf.destroy();
        this._octa.destroy();
        this._billboard.destroy();
        this._gbufferPass.destroy();
        this._maskPass.destroy();
        this._shadePass.destroy();
        this._fallbackSDF?.destroy();
        this._fallbackOctAtlas?.destroy();
    }

    // =========================================================================
    // GPU-Only API (for compute shader-driven instances)
    // =========================================================================

    /**
     * Set GPU instance buffer directly (for compute shader-driven instances).
     * Bypasses CPU-side instance management.
     *
     * @param {GPUBuffer} instanceBuffer - StructuredBuffer with InstanceData layout
     * @param {number} instanceCount
     */
    setGPUInstanceBuffer(instanceBuffer, instanceCount) {
        this._instanceBuffer = instanceBuffer;
        this._instanceCount = instanceCount;
        this._instanceCapacity = instanceCount;
        this._gpuOnlyMode = true;
        this.stats.instanceCount = instanceCount;
    }

    /**
     * Set GPU TLAS buffer directly (for compute shader-driven BVH).
     *
     * @param {GPUBuffer} tlasBuffer - BVH node buffer
     * @param {GPUBuffer} tlasInstanceBuffer - Instance index buffer
     */
    setGPUTLASBuffers(tlasBuffer, tlasInstanceBuffer) {
        this._tlas.setGPUBuffers(tlasBuffer, tlasInstanceBuffer);
    }

    /**
     * Set asset half extents buffer for GPU TLAS refit.
     *
     * @param {GPUBuffer} halfExtentsBuffer - vec3<f32> array of half extents per asset
     */
    setAssetHalfExtentsBuffer(halfExtentsBuffer) {
        this._assetHalfExtentsBuffer = halfExtentsBuffer;
    }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    _initInstanceBuffer(capacity) {
        if (this._instanceBuffer) this._instanceBuffer.destroy();
        this._instanceBuffer = this.device.createBuffer({
            size  : capacity * INSTANCE_STRIDE,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label : 'ProxyInstances',
        });
        this._instanceCapacity = capacity;
    }

    _growInstanceBuffer() {
        const newCap = this._instanceCapacity * GROWTH_FACTOR;
        console.log(`[ProxyGeometrySystem] Growing instance buffer: ${this._instanceCapacity} → ${newCap}`);
        const oldBuffer = this._instanceBuffer;
        this._initInstanceBuffer(newCap);
        // Re-upload all instances
        this._rebuildInstanceBuffer();
        oldBuffer.destroy();

        // Re-create billboard aligner with new buffer
        this._billboard.destroy();
        this._billboard = new ProxyBillboardAlign(this.device, this._instanceBuffer);
    }

    _rebuildInstanceBuffer() {
        for (let i = 0; i < this._instances.length; i++) {
            const rec   = this._instances[i];
            const asset = this._assets.get(rec.assetId);
            if (!asset) continue;
            this._uploadInstance(i, rec.worldMat, rec.assetId, rec.mode, asset.halfExtents);
        }
    }

    _uploadInstance(gpuIdx, worldMat, assetId, mode, halfExtents) {
        // GPU layout (96 bytes = 24 f32):
        // worldMat (16 f32) | targetAssetId (u32) | proxyMode (u32) | halfExtentsXYZ (3 f32) | _pad×3 (u32)
        _instanceUpload.set(worldMat, 0);        // 16 floats
        _instanceU32[16] = assetId;
        _instanceU32[17] = mode;
        _instanceUpload[18] = halfExtents[0];
        _instanceUpload[19] = halfExtents[1];
        _instanceUpload[20] = halfExtents[2];
        _instanceU32[21] = 0;
        _instanceU32[22] = 0;
        _instanceU32[23] = 0;
        this.device.queue.writeBuffer(this._instanceBuffer, gpuIdx * INSTANCE_STRIDE, _instanceUpload);
    }

    _initFallbackTextures() {
        // 1×1×1 r16float SDF (value 1.0 = fully outside)
        this._fallbackSDF = this.device.createTexture({
            size     : [1, 1, 1],
            format   : 'r16float',
            dimension: '3d',
            usage    : GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label    : 'ProxyFallbackSDF',
        });
        const sdfData = new Float32Array([1.0]);
        this.device.queue.writeTexture(
            { texture: this._fallbackSDF },
            sdfData,
            { bytesPerRow: 4, rowsPerImage: 1 },
            [1, 1, 1],
        );

        // 1×1 rgba8 black atlas (alpha = 0 → fully transparent)
        this._fallbackOctAtlas = this.device.createTexture({
            size  : [1, 1, 1],
            format: 'rgba8unorm',
            usage : GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label : 'ProxyFallbackOctAtlas',
        });
        const atlasData = new Uint8Array([0, 0, 0, 0]);
        this.device.queue.writeTexture(
            { texture: this._fallbackOctAtlas },
            atlasData,
            { bytesPerRow: 4, rowsPerImage: 1 },
            [1, 1, 1],
        );
    }

    _getAnySdfView() {
        for (const [id] of this._assets) {
            const view = this._sdf.getTextureView(id);
            if (view) return view;
        }
        return null;
    }

    _getAnySdfScale() {
        for (const [id] of this._assets) {
            const scale = this._sdf.getSDFScale(id);
            if (scale) return scale;
        }
        return 1.0;
    }

    _getAnyOctView() {
        for (const [id] of this._assets) {
            const tex = this._octa.getColorAtlas(id);
            if (tex) return tex.createView();
        }
        return null;
    }

    _getAnyMaterial() {
        for (const asset of this._assets.values()) {
            if (asset.material) return asset.material;
        }
        return null;
    }

    _computeMaxBounces() {
        // Scale max transparent bounces with proxy density
        // Minimum 16; increases if we have many overlapping proxies
        return Math.min(16 + Math.floor(this._instanceCount / 20), 64);
    }

    _estimateAssetTriangles(asset) {
        if (!asset.bvh) return 0;
        return asset.bvh.triangleCount ?? 0;
    }
}

// ============================================================================
// Math Helpers
// ============================================================================

/**
 * Normalize the scale out of a world matrix, preserving position and rotation.
 * This enforces the Blender constraint: proxy scale must be identity at Object level.
 */
function _normalizeScale(mat) {
    const out = new Float32Array(mat);
    // Extract and normalize each column (rotation cols 0-2)
    for (let col = 0; col < 3; col++) {
        const o = col * 4;
        const len = Math.sqrt(out[o]**2 + out[o+1]**2 + out[o+2]**2);
        if (len > 1e-6) {
            out[o]   /= len;
            out[o+1] /= len;
            out[o+2] /= len;
        }
    }
    return out;
}

/**
 * Compute world-space AABB of a box proxy with given half-extents.
 */
function _worldAABB(worldMat, hx, hy, hz) {
    const corners = [
        [-hx,-hy,-hz],[hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz],
        [-hx,-hy, hz],[hx,-hy, hz],[-hx,hy, hz],[hx,hy, hz],
    ];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [cx, cy, cz] of corners) {
        const wx = worldMat[0]*cx + worldMat[4]*cy + worldMat[8]*cz  + worldMat[12];
        const wy = worldMat[1]*cx + worldMat[5]*cy + worldMat[9]*cz  + worldMat[13];
        const wz = worldMat[2]*cx + worldMat[6]*cy + worldMat[10]*cz + worldMat[14];
        minX = Math.min(minX, wx); minY = Math.min(minY, wy); minZ = Math.min(minZ, wz);
        maxX = Math.max(maxX, wx); maxY = Math.max(maxY, wy); maxZ = Math.max(maxZ, wz);
    }
    return { aabbMin: [minX, minY, minZ], aabbMax: [maxX, maxY, maxZ] };
}
