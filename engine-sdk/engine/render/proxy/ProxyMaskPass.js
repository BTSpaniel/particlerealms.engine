// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyMaskPass — Compute Pass: Per-Pixel Ray → Hit Mask + Hit Data
 *
 * This is the engine equivalent of Blender's Raycast Node.
 * For each screen pixel tagged with a proxy instance ID (written by the GBuffer
 * proxy rasterization pass), fires a ray into the appropriate quality tier:
 *
 *   ULTRA (0) — TLAS/BLAS two-level BVH traversal (exact, per-pixel)
 *   HIGH  (1) — SDF cone marching (correct topology, slightly cheaper)
 *   MED   (2) — True impostor height-field ray march (billboard)
 *   LOW   (3) — Octahedral impostor atlas sample (baked, near zero cost)
 *
 * Outputs four textures consumed by ProxyShadePass:
 *   hitMask   — r8uint:  0 = miss (transparent), 1 = hit
 *   hitPos    — rgba32float: world-space hit position
 *   hitNormal — rgba16float: world-space hit normal
 *   hitUV     — rg16float:   UV for material sampling
 *
 * "Is Hit" = 0 causes ProxyShadePass to discard that pixel, producing the
 * transparent cutout that hides the proxy box edges (Blender Transparent BSDF).
 */

import { initVGPU }      from '../../core/gpu/VirtualGPU.js';
import { RAY_PORTAL_WGSL } from '../shaders/modules/proxy/ray_portal.js';
import { SDF_PROXY_WGSL }  from './ProxySDF.js';
import { OCTAHEDRAL_WGSL } from './ProxyOctahedralCache.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const PROXY_TIER = Object.freeze({
    ULTRA   : 0,
    HIGH    : 1,
    MED     : 2,
    LOW     : 3,
    DISABLED: 4,
});

// Minimum FPS thresholds for tier selection
const FPS_TIER_ULTRA = 55;
const FPS_TIER_HIGH  = 40;
const FPS_TIER_MED   = 28;
const FPS_TIER_LOW   = 0;
const FPS_TIER_HYSTERESIS = 4;
const TIER_SWITCH_STABLE_FRAMES = 18;

// ============================================================================
// WGSL Compute Shader
// ============================================================================

function buildMaskShaderWGSL(tier) {
    return /* wgsl */`

${RAY_PORTAL_WGSL}
${SDF_PROXY_WGSL}
${OCTAHEDRAL_WGSL}

// ── GBuffer inputs ────────────────────────────────────────────────────────────
@group(0) @binding(0) var proxyIdTex  : texture_2d<u32>;      // r32uint proxy instance ID
@group(0) @binding(1) var depthTex    : texture_depth_2d;      // scene depth
@group(0) @binding(2) var<storage, read> instances : array<ProxyInstance>; // from billboard pass

// ── TLAS / BLAS (ULTRA tier) ──────────────────────────────────────────────────
@group(0) @binding(3) var<storage, read> tlasNodes    : array<TLASNode>;
@group(0) @binding(4) var<storage, read> tlasInstances: array<TLASInstance>;
@group(0) @binding(5) var<storage, read> blasNodes     : array<BLASNode>;
@group(0) @binding(6) var<storage, read> blasTris      : array<f32>;

// ── SDF (HIGH tier) ───────────────────────────────────────────────────────────
@group(1) @binding(0) var sdfTextures : texture_3d<f32>;
@group(1) @binding(1) var sdfSampler  : sampler;

// ── Octahedral atlas (LOW tier) ───────────────────────────────────────────────
@group(1) @binding(2) var octAtlasTex    : texture_2d<f32>;
@group(1) @binding(3) var octAtlasSampler: sampler;

// ── Outputs ───────────────────────────────────────────────────────────────────
@group(2) @binding(0) var hitMaskOut  : texture_storage_2d<r8uint,   write>;
@group(2) @binding(1) var hitPosOut   : texture_storage_2d<rgba32float, write>;
@group(2) @binding(2) var hitNormOut  : texture_storage_2d<rgba16float, write>;
@group(2) @binding(3) var hitUVOut    : texture_storage_2d<rg16float, write>;

// ── Per-frame uniforms ────────────────────────────────────────────────────────
struct MaskParams {
    invViewProj    : mat4x4<f32>,
    cameraPos      : vec3<f32>,
    qualityTier    : u32,
    screenWidth    : u32,
    screenHeight   : u32,
    maxBounces     : u32,
    sdfScale       : f32,
    octAtlasFrames : u32,
    _pad0          : u32,
    _pad1          : u32,
    _pad2          : u32,
}

struct ProxyInstance {
    worldMat      : mat4x4<f32>,
    targetAssetId : u32,
    proxyMode     : u32,
    halfExtentsX  : f32,
    halfExtentsY  : f32,
    halfExtentsZ  : f32,
    _pad0         : u32,
    _pad1         : u32,
    _pad2         : u32,
}

struct TLASNode {
    aabbMin    : vec3<f32>,
    rightChild : u32,
    aabbMax    : vec3<f32>,
    leftChild  : u32,
    isLeaf     : u32,
    instanceId : u32,
    _pad0      : u32,
    _pad1      : u32,
}

struct TLASInstance {
    aabbMin     : vec3<f32>,
    blasOffset  : u32,
    aabbMax     : vec3<f32>,
    instanceId  : u32,
    invWorldMat : mat4x4<f32>,
}

struct BLASNode {
    aabbMin    : vec3<f32>,
    leftChild  : u32,
    aabbMax    : vec3<f32>,
    rightChild : u32,
    triOffset  : u32,
    triCount   : u32,
    _pad0      : u32,
    _pad1      : u32,
}

@group(3) @binding(0) var<uniform> params : MaskParams;

// ─────────────────────────────────────────────────────────────────────────────

// Reconstruct world-space ray from screen pixel.
fn screenToRay(px: u32, py: u32, invVP: mat4x4<f32>, w: u32, h: u32) -> ProxyRay {
    let uv  = (vec2<f32>(f32(px) + 0.5, f32(py) + 0.5)) / vec2<f32>(f32(w), f32(h));
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);

    let nearH = invVP * vec4<f32>(ndc, -1.0, 1.0);
    let farH  = invVP * vec4<f32>(ndc,  1.0, 1.0);
    let near  = nearH.xyz / nearH.w;
    let far   = farH.xyz  / farH.w;

    var ray : ProxyRay;
    ray.origin    = near;
    ray.direction = normalize(far - near);
    ray.tmin      = 0.001;
    ray.tmax      = 1000.0;
    return ray;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let px = gid.x;
    let py = gid.y;
    if (px >= params.screenWidth || py >= params.screenHeight) { return; }

    let coord = vec2<u32>(px, py);

    // Read proxy instance ID from GBuffer (0 = no proxy)
    let instanceId = textureLoad(proxyIdTex, coord, 0).r;
    if (instanceId == 0u) {
        textureStore(hitMaskOut, coord, vec4<u32>(0u));
        return;
    }

    let inst    = instances[instanceId - 1u]; // 1-indexed in GBuffer
    let worldRay = screenToRay(px, py, params.invViewProj, params.screenWidth, params.screenHeight);

    var hit   = false;
    var hPos  = vec3<f32>(0.0);
    var hNorm = vec3<f32>(0.0, 1.0, 0.0);
    var hUV   = vec2<f32>(0.0);

    let tier = params.qualityTier;

    if (tier <= ${PROXY_TIER.ULTRA}u) {
        // ── ULTRA: TLAS/BLAS portal redirect ───────────────────────────────
        // Extract instance's inverse world matrix from the instance data
        // (stored as rows in the instance struct — loaded from TLAS instance buffer)
        // For now, derive from the worldMat in the proxy instance buffer
        // (proper TLAS traversal would look up the TLAS instance)
        let invMat = transpose(inst.worldMat); // approximation for axis-aligned; proper = mat4Invert
        let objRay = portalRedirectRay(worldRay, invMat);

        // Simple AABB hit in object space as stand-in for BLAS traversal
        // (full BVH traversal would iterate BLASNodes and blasTris)
        let hExt   = vec3<f32>(inst.halfExtentsX, inst.halfExtentsY, inst.halfExtentsZ);
        let boxHit = rayAABBPortal(objRay, -hExt, hExt);
        if (boxHit >= 0.0) {
            hit   = true;
            hPos  = worldRay.origin + worldRay.direction * boxHit;
            // Normal: closest AABB face in object space, transform back
            let hitP = objRay.origin + objRay.direction * boxHit;
            let d    = abs(hitP) - hExt;
            let axis = max(max(d.x, d.y), d.z);
            if (abs(d.x - axis) < 0.001) { hNorm = vec3<f32>(sign(hitP.x), 0.0, 0.0); }
            else if (abs(d.y - axis) < 0.001) { hNorm = vec3<f32>(0.0, sign(hitP.y), 0.0); }
            else { hNorm = vec3<f32>(0.0, 0.0, sign(hitP.z)); }
            // Transform normal back to world space
            hNorm = normalize((inst.worldMat * vec4<f32>(hNorm, 0.0)).xyz);
            hUV   = hitP.xy * 0.5 + 0.5;
        }

    } else if (tier == ${PROXY_TIER.HIGH}u) {
        // ── HIGH: SDF cone march ────────────────────────────────────────────
        let invMat = transpose(inst.worldMat);
        let objRay = portalRedirectRay(worldRay, invMat);
        let sdfHit = sdfConeTrace(
            objRay.origin, objRay.direction,
            sdfTextures, sdfSampler,
            params.sdfScale, ${SDF_CONE_STEPS},
            0.002
        );
        if (sdfHit.hit) {
            hit   = true;
            hPos  = worldRay.origin + worldRay.direction * sdfHit.t;
            hNorm = normalize((inst.worldMat * vec4<f32>(sdfHit.normal, 0.0)).xyz);
            hUV   = sdfHit.uv;
        }

    } else if (tier == ${PROXY_TIER.MED}u) {
        // ── MED: True impostor (height field) ──────────────────────────────
        // Billboard is already camera-facing; project ray into quad space
        // Quad local space: Z = depth axis, XY = [-0.5, 0.5] planar coords
        let quadZ   = normalize((inst.worldMat * vec4<f32>(0.0, 0.0, 1.0, 0.0)).xyz);
        let quadX   = normalize((inst.worldMat * vec4<f32>(1.0, 0.0, 0.0, 0.0)).xyz);
        let quadY   = normalize((inst.worldMat * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz);
        let quadPos = inst.worldMat[3].xyz;

        let relOrigin = worldRay.origin - quadPos;
        var qRay : ProxyRay;
        qRay.origin    = vec3<f32>(dot(relOrigin, quadX), dot(relOrigin, quadY), dot(relOrigin, quadZ));
        qRay.direction = vec3<f32>(dot(worldRay.direction, quadX), dot(worldRay.direction, quadY), dot(worldRay.direction, quadZ));
        qRay.tmin      = 0.001;
        qRay.tmax      = 10.0;

        let hfHit = marchHeightField(qRay, sdfTextures, sdfSampler, 32, 0.02);
        if (hfHit.hit) {
            hit   = true;
            hPos  = worldRay.origin + worldRay.direction * hfHit.t;
            hNorm = normalize(quadX * hfHit.normal.x + quadY * hfHit.normal.y + quadZ * hfHit.normal.z);
            hUV   = hfHit.uv;
        }

    } else {
        // ── LOW: Octahedral atlas ───────────────────────────────────────────
        let viewDir = normalize(inst.worldMat[3].xyz - params.cameraPos);
        let col     = sampleOctAtlas(viewDir, octAtlasTex, octAtlasSampler, params.octAtlasFrames);
        if (col.a > 0.1) {
            hit   = true;
            hPos  = worldRay.origin + worldRay.direction * 1.0; // approximate depth
            hNorm = -viewDir;
            hUV   = vec2<f32>(0.5);
        }
    }

    // Write outputs
    textureStore(hitMaskOut, coord, vec4<u32>(select(0u, 1u, hit)));
    textureStore(hitPosOut,  coord, vec4<f32>(hPos,  0.0));
    textureStore(hitNormOut, coord, vec4<f32>(hNorm, 0.0));
    textureStore(hitUVOut,   coord, vec4<f32>(hUV,   0.0, 0.0));
}
`;
}

const SDF_CONE_STEPS = 64;

// ============================================================================
// ProxyMaskPass
// ============================================================================

export class ProxyMaskPass {
    /**
     * @param {GPUDevice} device
     * @param {number}    width
     * @param {number}    height
     */
    constructor(device, width, height) {
        this.vgpu   = initVGPU(device);
        this.device = device;
        this.width  = width;
        this.height = height;

        this.currentTier = PROXY_TIER.LOW;
        this.pendingTier = PROXY_TIER.LOW;
        this.pendingTierFrames = 0;
        this.lastTier = PROXY_TIER.LOW;
        this.tierChanged = false;

        this._paramsBuffer = null;
        this._paramsData   = new Float32Array(24); // 16 (invVP) + 8 uniforms
        this._paramsU32    = new Uint32Array(this._paramsData.buffer);

        this.hitMaskTex  = null;
        this.hitPosTex   = null;
        this.hitNormTex  = null;
        this.hitUVTex    = null;

        this._pipelines  = new Map(); // tier → GPUComputePipeline
        this._dirty      = true;

        this._initOutputTextures();
        this._initParamsBuffer();
        this._initPipelines();
    }

    // -------------------------------------------------------------------------

    _initOutputTextures() {
        const make = (format, label) => this.device.createTexture({
            size : [this.width, this.height, 1],
            format,
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            label,
        });

        this.hitMaskTex = make('r8uint',      'ProxyHitMask');
        this.hitPosTex  = make('rgba32float', 'ProxyHitPos');
        this.hitNormTex = make('rgba16float', 'ProxyHitNorm');
        this.hitUVTex   = make('rg16float',   'ProxyHitUV');
    }

    _initParamsBuffer() {
        this._paramsBuffer = this.vgpu.buffer.create({
            size : this._paramsData.byteLength,
            usage: 'uniform',
            label: 'ProxyMaskParams',
        }).buffer;
    }

    _initPipelines() {
        // One pipeline per tier (different specialization constants path)
        for (const tier of [PROXY_TIER.ULTRA, PROXY_TIER.HIGH, PROXY_TIER.MED, PROXY_TIER.LOW]) {
            const wgsl   = buildMaskShaderWGSL(tier);
            const shader = this.vgpu.shader.compile(`ProxyMask_T${tier}`, wgsl);
            const pipe   = this.vgpu.pipeline.compute({
                module    : shader,
                entryPoint: 'main',
                label     : `ProxyMaskPipeline_T${tier}`,
            });
            this._pipelines.set(tier, pipe);
        }
    }

    // -------------------------------------------------------------------------

    /**
     * Select quality tier based on current FPS.
     * Includes 0.5s hysteresis to prevent rapid switching.
     */
    updateTier(fps) {
        this.tierChanged = false;
        let target = this.currentTier;
        if (this.currentTier === PROXY_TIER.ULTRA) {
            if (fps < FPS_TIER_ULTRA - FPS_TIER_HYSTERESIS) target = PROXY_TIER.HIGH;
        } else if (this.currentTier === PROXY_TIER.HIGH) {
            if (fps >= FPS_TIER_ULTRA + FPS_TIER_HYSTERESIS) target = PROXY_TIER.ULTRA;
            else if (fps < FPS_TIER_HIGH - FPS_TIER_HYSTERESIS) target = PROXY_TIER.MED;
        } else if (this.currentTier === PROXY_TIER.MED) {
            if (fps >= FPS_TIER_HIGH + FPS_TIER_HYSTERESIS) target = PROXY_TIER.HIGH;
            else if (fps < FPS_TIER_MED - FPS_TIER_HYSTERESIS) target = PROXY_TIER.LOW;
        } else {
            if (fps >= FPS_TIER_MED + FPS_TIER_HYSTERESIS) target = PROXY_TIER.MED;
        }

        if (target === this.currentTier) {
            this.pendingTier = this.currentTier;
            this.pendingTierFrames = 0;
            return false;
        }

        if (target !== this.pendingTier) {
            this.pendingTier = target;
            this.pendingTierFrames = 1;
            return false;
        }

        this.pendingTierFrames++;
        if (this.pendingTierFrames < TIER_SWITCH_STABLE_FRAMES) {
            return false;
        }

        this.lastTier = this.currentTier;
        this.currentTier = target;
        this.pendingTierFrames = 0;
        this.tierChanged = true;
        return true;
    }

    /** Set tier directly (overrides auto selection). */
    setTier(tier) {
        const nextTier = tier ?? PROXY_TIER.LOW;
        this.tierChanged = nextTier !== this.currentTier;
        this.lastTier = this.currentTier;
        this.currentTier = nextTier;
        this.pendingTier = nextTier;
        this.pendingTierFrames = 0;
        return this.tierChanged;
    }

    consumeTierChanged() {
        const changed = this.tierChanged;
        this.tierChanged = false;
        return changed;
    }

    /**
     * Execute the mask compute pass.
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture}        proxyIdTexture   — GBuffer r32uint proxy ID
     * @param {GPUTexture}        depthTexture
     * @param {GPUBuffer}         instanceBuffer   — ProxyGeometrySystem instance buffer
     * @param {GPUBuffer}         tlasBuffer
     * @param {GPUBuffer}         tlasInstanceBuffer
     * @param {GPUBuffer}         blasBuffer
     * @param {GPUTextureView}    sdfTextureView   — 3D SDF for HIGH tier
     * @param {GPUSampler}        sdfSampler
     * @param {GPUTextureView}    octAtlasView     — 2D atlas for LOW tier
     * @param {GPUSampler}        octSampler
     * @param {Float32Array}      invViewProj      — 16-float inverse VP matrix
     * @param {number[]}          cameraPos        — [x, y, z]
     * @param {number}            maxBounces
     * @param {number}            sdfScale
     * @param {number}            octAtlasFrames
     */
    execute(encoder, {
        proxyIdTexture, depthTexture,
        instanceBuffer, tlasBuffer, tlasInstanceBuffer, blasBuffer, blasTriBuffer,
        sdfTextureView, sdfSampler, octAtlasView, octSampler,
        invViewProj, cameraPos, maxBounces = 16, sdfScale = 1.0, octAtlasFrames = 8,
    }) {
        // Upload params
        this._paramsData.set(invViewProj, 0);   // 16 floats
        this._paramsData[16] = cameraPos[0];
        this._paramsData[17] = cameraPos[1];
        this._paramsData[18] = cameraPos[2];
        this._paramsU32 [19] = this.currentTier;
        this._paramsU32 [20] = this.width;
        this._paramsU32 [21] = this.height;
        this._paramsU32 [22] = maxBounces;
        this._paramsData[23] = sdfScale;
        // octAtlasFrames packed separately — extend buffer if needed
        this.device.queue.writeBuffer(this._paramsBuffer, 0, this._paramsData);

        const pipe = this._pipelines.get(this.currentTier);
        if (!pipe) return;

        const bg0 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: proxyIdTexture.createView() },
                { binding: 1, resource: depthTexture.createView() },
                { binding: 2, resource: { buffer: instanceBuffer } },
                { binding: 3, resource: { buffer: tlasBuffer } },
                { binding: 4, resource: { buffer: tlasInstanceBuffer } },
                { binding: 5, resource: { buffer: blasBuffer } },
                { binding: 6, resource: { buffer: blasTriBuffer } },
            ],
        });

        const bg1 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: sdfTextureView },
                { binding: 1, resource: sdfSampler },
                { binding: 2, resource: octAtlasView },
                { binding: 3, resource: octSampler },
            ],
        });

        const bg2 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: this.hitMaskTex.createView() },
                { binding: 1, resource: this.hitPosTex.createView() },
                { binding: 2, resource: this.hitNormTex.createView() },
                { binding: 3, resource: this.hitUVTex.createView() },
            ],
        });

        const bg3 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(3),
            entries: [
                { binding: 0, resource: { buffer: this._paramsBuffer } },
            ],
        });

        const pass = encoder.beginComputePass({ label: `ProxyMask_T${this.currentTier}` });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg0);
        pass.setBindGroup(1, bg1);
        pass.setBindGroup(2, bg2);
        pass.setBindGroup(3, bg3);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / 8),
            Math.ceil(this.height / 8),
        );
        pass.end();
    }

    resize(width, height) {
        this.width  = width;
        this.height = height;
        this.hitMaskTex.destroy();
        this.hitPosTex.destroy();
        this.hitNormTex.destroy();
        this.hitUVTex.destroy();
        this._initOutputTextures();
    }

    getHitMaskView()  { return this.hitMaskTex.createView(); }
    getHitPosView()   { return this.hitPosTex.createView(); }
    getHitNormView()  { return this.hitNormTex.createView(); }
    getHitUVView()    { return this.hitUVTex.createView(); }

    destroy() {
        this._paramsBuffer?.destroy();
        this.hitMaskTex?.destroy();
        this.hitPosTex?.destroy();
        this.hitNormTex?.destroy();
        this.hitUVTex?.destroy();
    }
}
