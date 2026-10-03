// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyOctahedralCache — Baked Octahedral Impostor Atlas
 *
 * Pre-renders a target asset from N×N octahedral viewpoints and packs the
 * results into a single texture atlas. At runtime, proxy billboards sample
 * the nearest 4 frames (bilinearly blended in octahedral space).
 *
 * Technique from: Emil Poulsen / Unity Pixyz / UE5 Nanite fallback.
 *
 * Atlas layout:
 *   - atlasFrames × atlasFrames grid of FRAME_SIZE×FRAME_SIZE RGBA tiles
 *   - Each tile stores: RGB = color, A = alpha mask
 *   - An additional normal atlas stores XYZ normals (for lighting correction)
 *
 * Pros:  Near-zero runtime cost, excellent at distance.
 * Cons:  Baked offline (re-bake if mesh changes); limited parallax.
 * Fix:   Dirty flag triggers async re-bake; irradiance probe augments lighting.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { vec3Cross, vec3Dot, vec3Length } from '../../core/math/MathVec3.js';

// ============================================================================
// CONFIG
// ============================================================================

const ATLAS_FRAMES   = 8;       // 8×8 = 64 octahedral directions
const FRAME_SIZE     = 128;     // pixels per frame tile
const ATLAS_SIZE     = ATLAS_FRAMES * FRAME_SIZE; // 1024×1024 total

// ============================================================================
// WGSL — Octahedral encode / atlas UV helpers (used by ProxyMaskPass)
// ============================================================================

export const OCTAHEDRAL_WGSL = /* wgsl */`

fn octEncode(dir: vec3<f32>) -> vec2<f32> {
    let n  = dir / (abs(dir.x) + abs(dir.y) + abs(dir.z));
    var uv = n.xy;
    if (n.z < 0.0) {
        uv = (1.0 - abs(uv.yx)) * sign(uv);
    }
    return clamp(uv * 0.5 + 0.5, vec2<f32>(0.0), vec2<f32>(1.0));
}

fn sampleOctAtlas(
    viewDir      : vec3<f32>,
    atlasTex     : texture_2d<f32>,
    atlasSampler : sampler,
    atlasFrames  : u32
) -> vec4<f32> {
    let fCount   = f32(atlasFrames);
    let frameUV  = octEncode(viewDir) * fCount;
    let fi       = clamp(vec2<u32>(vec2<i32>(floor(frameUV))), vec2<u32>(0u), vec2<u32>(atlasFrames - 1u));
    let frac     = fract(frameUV);
    let invF     = 1.0 / fCount;

    let f00 = fi;
    let f10 = min(fi + vec2<u32>(1u, 0u), vec2<u32>(atlasFrames - 1u));
    let f01 = min(fi + vec2<u32>(0u, 1u), vec2<u32>(atlasFrames - 1u));
    let f11 = min(fi + vec2<u32>(1u, 1u), vec2<u32>(atlasFrames - 1u));

    // Center of each tile in atlas UV
    let c00 = textureSampleLevel(atlasTex, atlasSampler, (vec2<f32>(f00) + 0.5) * invF, 0.0);
    let c10 = textureSampleLevel(atlasTex, atlasSampler, (vec2<f32>(f10) + 0.5) * invF, 0.0);
    let c01 = textureSampleLevel(atlasTex, atlasSampler, (vec2<f32>(f01) + 0.5) * invF, 0.0);
    let c11 = textureSampleLevel(atlasTex, atlasSampler, (vec2<f32>(f11) + 0.5) * invF, 0.0);

    return mix(mix(c00, c10, frac.x), mix(c01, c11, frac.x), frac.y);
}
`;

// ============================================================================
// ProxyOctahedralCache
// ============================================================================

export class ProxyOctahedralCache {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.vgpu   = initVGPU(device);
        this.device = device;

        /** @type {Map<number, {colorAtlas: GPUTexture, normalAtlas: GPUTexture, dirty: boolean}>} */
        this.atlases = new Map();

        this._sampler = device.createSampler({
            magFilter  : 'linear',
            minFilter  : 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
    }

    /**
     * Register a target asset for octahedral baking.
     * Immediately marks dirty — call bakeAsync() to generate the atlas.
     * @param {number} assetId
     */
    register(assetId) {
        if (this.atlases.has(assetId)) return;

        const colorAtlas = this.device.createTexture({
            size   : [ATLAS_SIZE, ATLAS_SIZE, 1],
            format : 'rgba8unorm',
            usage  : GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label  : `OctAtlasColor_${assetId}`,
        });

        const normalAtlas = this.device.createTexture({
            size   : [ATLAS_SIZE, ATLAS_SIZE, 1],
            format : 'rgba8unorm',
            usage  : GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label  : `OctAtlasNormal_${assetId}`,
        });

        this.atlases.set(assetId, { colorAtlas, normalAtlas, dirty: true });
    }

    /**
     * Bake the octahedral atlas for an asset.
     * Renders ATLAS_FRAMES×ATLAS_FRAMES views by rotating a virtual camera
     * around the asset on an octahedral grid.
     *
     * @param {number}   assetId
     * @param {Function} renderAssetFn  (commandEncoder, viewProj, viewport) => void
     *                                  Caller provides function to render the asset.
     */
    async bakeAsync(assetId, renderAssetFn) {
        const entry = this.atlases.get(assetId);
        if (!entry || !entry.dirty) return;

        const encoder = this.device.createCommandEncoder({ label: `OctBake_${assetId}` });

        for (let row = 0; row < ATLAS_FRAMES; row++) {
            for (let col = 0; col < ATLAS_FRAMES; col++) {
                const frameIdx = row * ATLAS_FRAMES + col;

                // Compute octahedral view direction for this frame
                const u = (col + 0.5) / ATLAS_FRAMES;
                const v = (row + 0.5) / ATLAS_FRAMES;
                const viewDir = this._octDecode(u, v);
                const viewProj = this._buildOrthoViewProj(viewDir);

                // Viewport maps to this frame's tile in the atlas
                const viewport = {
                    x      : col * FRAME_SIZE,
                    y      : row * FRAME_SIZE,
                    width  : FRAME_SIZE,
                    height : FRAME_SIZE,
                };

                // Render the asset from this view direction into the atlas tile
                renderAssetFn(encoder, viewProj, viewport, entry.colorAtlas, entry.normalAtlas);
            }
        }

        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        entry.dirty = false;
    }

    /** Mark an asset's atlas as needing a re-bake (e.g., material changed). */
    markDirty(assetId) {
        const entry = this.atlases.get(assetId);
        if (entry) entry.dirty = true;
    }

    /** Returns the color atlas texture for an asset (or null if not baked). */
    getColorAtlas(assetId) {
        return this.atlases.get(assetId)?.colorAtlas ?? null;
    }

    /** Returns the normal atlas texture for an asset (or null if not baked). */
    getNormalAtlas(assetId) {
        return this.atlases.get(assetId)?.normalAtlas ?? null;
    }

    getSampler() { return this._sampler; }

    getAtlasFrameCount() { return ATLAS_FRAMES; }

    destroy() {
        for (const { colorAtlas, normalAtlas } of this.atlases.values()) {
            colorAtlas.destroy();
            normalAtlas.destroy();
        }
        this.atlases.clear();
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    /** Decode octahedral [0,1]^2 UV to unit sphere direction. */
    _octDecode(u, v) {
        const fx = u * 2.0 - 1.0;
        const fy = v * 2.0 - 1.0;
        const fz = 1.0 - Math.abs(fx) - Math.abs(fy);
        if (fz < 0) {
            const x = (1.0 - Math.abs(fy)) * Math.sign(fx);
            const y = (1.0 - Math.abs(fx)) * Math.sign(fy);
            const len = Math.sqrt(x*x + y*y + fz*fz);
            return [x/len, y/len, fz/len];
        }
        const len = Math.sqrt(fx*fx + fy*fy + fz*fz);
        return [fx/len, fy/len, fz/len];
    }

    /**
     * Build an orthographic view-projection matrix looking from viewDir toward origin.
     * Returns a column-major Float32Array(16).
     */
    _buildOrthoViewProj(viewDir) {
        const [vx, vy, vz] = viewDir;
        const eye = [vx * 3, vy * 3, vz * 3];
        const up  = Math.abs(vy) > 0.99 ? [1,0,0] : [0,1,0];

        // View matrix (lookAt)
        const fwd  = [-vx, -vy, -vz];
        const right = vec3Cross(up, fwd);
        const rLen  = vec3Length(right);
        const r     = [right[0]/rLen, right[1]/rLen, right[2]/rLen];
        const u2    = vec3Cross(fwd, r);

        const view = new Float32Array([
            r[0], u2[0], fwd[0], 0,
            r[1], u2[1], fwd[1], 0,
            r[2], u2[2], fwd[2], 0,
            -vec3Dot(r, eye), -vec3Dot(u2, eye), -vec3Dot(fwd, eye), 1,
        ]);

        // Orthographic projection
        const size = 2.0;
        const near = 0.1, far = 20.0;
        const proj = new Float32Array([
            1/size, 0, 0, 0,
            0, 1/size, 0, 0,
            0, 0, -2/(far-near), 0,
            0, 0, -(far+near)/(far-near), 1,
        ]);

        return _mat4Mul(proj, view);
    }
}

function _mat4Mul(a, b) {
    const out = new Float32Array(16);
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    return out;
}
