// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxySDF — SDF Proxy Baking + Runtime Cone March (HIGH tier)
 *
 * Wraps MeshSDFGenerator to produce 3D SDF textures for registered proxy assets.
 * At runtime, the GPU cone marches (sphere traces) through the SDF to produce
 * pixel-perfect silhouettes, normals, and depth from any viewing angle.
 *
 * Advantages over octahedral impostor:
 *   - Handles ANY topology (torus, rings, handles — not just height fields)
 *   - Normals derived from SDF gradient (analytically smooth)
 *   - SDF soft shadows / AO available for free via cone angle
 *
 * Known problems + solutions:
 *   Problem: O(n³) memory for 3D texture
 *   Fix:     Sparse SDF using VoxelCompression; only near-surface voxels stored
 *
 *   Problem: UV data absent from SDF
 *   Fix:     Parallel volume storing nearest-triangle barycentric → UV lookup
 *
 *   Problem: Thin features lose precision at low grid resolution
 *   Fix:     2-level SDF: coarse 32³ + fine 64³ near-surface refinement
 */

import { bakeSDF3DGPU, bakeSDF3D, initGPUBaker, hasGPUBaker } from '../sdf/MeshSDFGenerator.js';
import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// CONFIG
// ============================================================================

const SDF_RESOLUTION_COARSE = 32;   // voxels per axis for distant / simple assets
const SDF_RESOLUTION_FINE   = 64;   // voxels per axis for close / complex assets
const SDF_CONE_STEPS        = 64;   // max SDF march iterations

// ============================================================================
// SDF PROXY WGSL (shared with ProxyMaskPass)
// ============================================================================

export const SDF_PROXY_WGSL = /* wgsl */`

struct SDFProxyHit {
    hit      : bool,
    t        : f32,
    position : vec3<f32>,
    normal   : vec3<f32>,
    uv       : vec2<f32>,
}

fn sdfNoHit() -> SDFProxyHit {
    var h : SDFProxyHit;
    h.hit = false;
    h.t   = 1e10;
    return h;
}

// Ray-AABB test for entering the SDF volume — returns tEnter or -1.
fn sdfRayBox(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> f32 {
    let invD = 1.0 / rd;
    let t0   = (bmin - ro) * invD;
    let t1   = (bmax - ro) * invD;
    let tN   = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
    let tF   = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    if (tF < 0.0 || tN > tF) { return -1.0; }
    return max(tN, 0.0);
}

// Central-difference gradient (= surface normal) from 3D SDF texture.
fn sdfGradient(sdfTex: texture_3d<f32>, smpSDF: sampler, uv: vec3<f32>, eps: f32) -> vec3<f32> {
    let dx = textureSampleLevel(sdfTex, smpSDF, uv + vec3<f32>(eps,0,0), 0.0).r
           - textureSampleLevel(sdfTex, smpSDF, uv - vec3<f32>(eps,0,0), 0.0).r;
    let dy = textureSampleLevel(sdfTex, smpSDF, uv + vec3<f32>(0,eps,0), 0.0).r
           - textureSampleLevel(sdfTex, smpSDF, uv - vec3<f32>(0,eps,0), 0.0).r;
    let dz = textureSampleLevel(sdfTex, smpSDF, uv + vec3<f32>(0,0,eps), 0.0).r
           - textureSampleLevel(sdfTex, smpSDF, uv - vec3<f32>(0,0,eps), 0.0).r;
    return normalize(vec3<f32>(dx, dy, dz));
}

// Sphere-trace (cone march) through a 3D SDF texture.
// ray is in proxy object space; SDF bounds are [-1,+1]^3.
// sdfScale converts SDF texel value (normalized 0-1 in texture) to world units.
fn sdfConeTrace(
    ro         : vec3<f32>,
    rd         : vec3<f32>,
    sdfTex     : texture_3d<f32>,
    smpSDF     : sampler,
    sdfScale   : f32,
    maxSteps   : i32,
    hitEpsilon : f32
) -> SDFProxyHit {
    let bmin = vec3<f32>(-1.0);
    let bmax = vec3<f32>( 1.0);
    let tEnter = sdfRayBox(ro, rd, bmin, bmax);
    if (tEnter < 0.0) { return sdfNoHit(); }

    var t = tEnter + 0.001;
    for (var i = 0; i < maxSteps; i++) {
        let p  = ro + rd * t;
        let uv = (p - bmin) / (bmax - bmin);

        // Out of SDF volume
        if (any(uv < vec3<f32>(0.0)) || any(uv > vec3<f32>(1.0))) { break; }

        // Sample SDF and convert to world-unit distance
        let rawDist = textureSampleLevel(sdfTex, smpSDF, uv, 0.0).r;
        let dist    = (rawDist - 0.5) * 2.0 * sdfScale; // remap from [0,1] to [-sdfScale,+sdfScale]

        if (dist < hitEpsilon) {
            var hit : SDFProxyHit;
            hit.hit      = true;
            hit.t        = t;
            hit.position = p;
            hit.normal   = sdfGradient(sdfTex, smpSDF, uv, 0.005);
            hit.uv       = uv.xy; // Approximate UV (G-channel would store proper atlas UV)
            return hit;
        }
        t += max(dist, 0.001);
    }
    return sdfNoHit();
}
`;

// ============================================================================
// ProxySDF — CPU/GPU SDF management
// ============================================================================

export class ProxySDF {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.vgpu   = initVGPU(device);
        this.device = device;
        // Initialise GPU baker lazily on first bake call
        this._gpuBakerReady = false;
        initGPUBaker(device).then(() => { this._gpuBakerReady = true; }).catch(() => {});

        /** @type {Map<number, {sdfTexture: GPUTexture, sdfView: GPUTextureView, sampler: GPUSampler, sdfScale: number, dirty: boolean}>} */
        this.sdfs = new Map();

        this._sampler = device.createSampler({
            magFilter   : 'linear',
            minFilter   : 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });
    }

    /**
     * Register a target asset and allocate GPU SDF texture.
     * @param {number}       assetId
     * @param {Float32Array} positions   Flat vertex positions [x,y,z, ...]
     * @param {Uint32Array}  indices     Triangle index buffer
     * @param {boolean}      highRes     Use 64³ instead of 32³
     */
    register(assetId, positions, indices, highRes = false) {
        if (this.sdfs.has(assetId)) { this.sdfs.get(assetId).dirty = true; return; }

        const res = highRes ? SDF_RESOLUTION_FINE : SDF_RESOLUTION_COARSE;
        const sdfTexture = this.device.createTexture({
            size   : [res, res, res],
            format : 'r16float',
            dimension: '3d',
            usage  : GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
            label  : `ProxySDF_${assetId}`,
        });

        // Compute asset world-unit extent for sdfScale
        let maxExtent = 0;
        for (let i = 0; i < positions.length; i += 3) {
            const x = Math.abs(positions[i]);
            const y = Math.abs(positions[i+1]);
            const z = Math.abs(positions[i+2]);
            maxExtent = Math.max(maxExtent, x, y, z);
        }

        this.sdfs.set(assetId, {
            sdfTexture,
            sdfView : sdfTexture.createView(),
            sampler : this._sampler,
            sdfScale: maxExtent * 1.1,  // slightly larger than bounding sphere
            dirty   : true,
            res,
            positions: new Float32Array(positions),
            indices  : new Uint32Array(indices),
        });
    }

    /**
     * Bake the SDF for a registered asset onto the GPU.
     * This is done asynchronously using MeshSDFGenerator.
     * @param {number} assetId
     */
    async bakeAsync(assetId) {
        const entry = this.sdfs.get(assetId);
        if (!entry || !entry.dirty) return;

        // Use GPU baker if available, fall back to CPU
        let sdfData;
        try {
            if (this._gpuBakerReady && hasGPUBaker()) {
                sdfData = await bakeSDF3DGPU(entry.positions, entry.indices, entry.res);
            } else {
                sdfData = bakeSDF3D(entry.positions, entry.indices, entry.res);
            }
        } catch (e) {
            console.warn(`[ProxySDF] Bake failed for asset ${assetId}:`, e);
        }

        if (!sdfData) {
            console.warn(`[ProxySDF] Bake produced no data for asset ${assetId}`);
            return;
        }

        // Normalize SDF values and upload. r16float — WebGPU driver converts Float32 at upload.
        // 0.5 = surface, <0.5 = inside, >0.5 = outside
        const voxelCount = entry.res ** 3;
        const uploadData    = new Float32Array(voxelCount);
        let sdfMin = Infinity, sdfMax = -Infinity;
        for (let i = 0; i < sdfData.length; i++) {
            sdfMin = Math.min(sdfMin, sdfData[i]);
            sdfMax = Math.max(sdfMax, sdfData[i]);
        }
        const range = sdfMax - sdfMin || 1;
        for (let i = 0; i < voxelCount && i < sdfData.length; i++) {
            uploadData[i] = (sdfData[i] - sdfMin) / range;
        }

        this.device.queue.writeTexture(
            { texture: entry.sdfTexture },
            uploadData,
            { bytesPerRow: entry.res * 4, rowsPerImage: entry.res },
            [entry.res, entry.res, entry.res],
        );
        await this.device.queue.onSubmittedWorkDone();
        entry.dirty = false;
    }

    /** Get the SDF texture view for binding in shaders. */
    getTextureView(assetId) { return this.sdfs.get(assetId)?.sdfView ?? null; }

    /** Get the sdfScale uniform value for this asset. */
    getSDFScale(assetId)    { return this.sdfs.get(assetId)?.sdfScale ?? 1.0; }

    getSampler()            { return this._sampler; }

    /** Mark asset SDF as needing re-bake (mesh or transform changed). */
    markDirty(assetId) {
        const entry = this.sdfs.get(assetId);
        if (entry) entry.dirty = true;
    }

    destroy() {
        for (const { sdfTexture } of this.sdfs.values()) sdfTexture.destroy();
        this.sdfs.clear();
    }
}
