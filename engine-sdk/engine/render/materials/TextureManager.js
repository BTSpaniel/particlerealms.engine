// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { packORM8, unpackUint8x4 } from '../../core/math/MathPacking.js';
import {
    createTextureFromKtx2DataWithDecoder,
    inspectKtx2TextureData,
    isKtx2Container,
    selectKtx2TargetFormat,
} from '../../core/gpu/GpuTextureLoader.js';

/**
 * TextureManager.js - GPU Texture Loading & Caching
 * 
 * Loads images from disk/URLs, uploads to GPU as WebGPU textures,
 * caches by path to avoid double-loading, and provides default
 * placeholder textures for missing PBR slots.
 */

const DEFAULT_SAMPLER_DESC = {
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
};

/**
 * Create a TextureManager instance.
 * @param {GPUDevice} device
 * @returns {Object} TextureManager API
 */
export function createTextureManager(device, options = {}) {
    if (!device) throw new Error('TextureManager: device is required');

    /** @type {Map<string, {texture: GPUTexture, view: GPUTextureView, width: number, height: number}>} */
    const cache = new Map();
    const samplerCache = new Map();
    let ktx2Decoder = options.decodeKtx2Payload || options.transcodeKtx2 || null;
    if (ktx2Decoder !== null && typeof ktx2Decoder !== 'function') {
        throw new TypeError('TextureManager: KTX2 decoder must be a function or null');
    }

    /** Default sampler (shared across all textures) */
    const defaultSampler = device.createSampler(DEFAULT_SAMPLER_DESC);

    /** Clamp sampler for preview / non-tiling use */
    const clampSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    // ── Default placeholder textures (1×1 pixels) ──────────────────────

    function _make1x1(r, g, b, a, label) {
        const tex = device.createTexture({
            size: [1, 1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            label,
        });
        device.queue.writeTexture(
            { texture: tex },
            new Uint8Array([r, g, b, a]),
            { bytesPerRow: 4 },
            [1, 1, 1],
        );
        return { texture: tex, view: tex.createView(), width: 1, height: 1 };
    }

    function _make1x1PackedRGBA8(packed, label) {
        const [r, g, b, a] = unpackUint8x4(packed);
        return _make1x1(r, g, b, a, label);
    }

    const defaultWhite  = _make1x1(255, 255, 255, 255, 'default_white');
    const defaultBlack  = _make1x1(0,   0,   0,   255, 'default_black');
    const defaultNormal = _make1x1(128, 128, 255, 255, 'default_normal'); // tangent-space flat normal
    const defaultMR     = _make1x1PackedRGBA8(
        packORM8({ occlusion: 0, roughness: 0.5, metallic: 0, alpha: 1 }),
        'default_metallic_roughness',
    ); // metallic=0, roughness=0.5

    // ── Load from ImageBitmap ──────────────────────────────────────────

    /**
     * Upload an ImageBitmap to a GPUTexture.
     * @param {ImageBitmap} bitmap
     * @param {string} label
     * @returns {{texture: GPUTexture, view: GPUTextureView, width: number, height: number}}
     */
    function _uploadBitmap(bitmap, label, options = {}) {
        const { width, height } = bitmap;
        const texture = device.createTexture({
            size: [width, height, 1],
            format: options.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            label,
        });
        device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture },
            [width, height],
        );
        const view = texture.createView();
        return { texture, view, width, height };
    }

    function _ktx2Fallback(options) {
        return options.fallback || defaultWhite;
    }

    function _isKtx2Source(source, options = {}) {
        return options.ktx2 === true
            || source?.type === 'image/ktx2'
            || /\.ktx2(?:$|[?#])/i.test(source?.name || source || '');
    }

    async function loadKtx2(data, cacheKey, options = {}) {
        const key = String(cacheKey || 'ktx2');
        if (cache.has(key)) return cache.get(key);
        try {
            const bytes = data instanceof Uint8Array
                ? data
                : new Uint8Array(ArrayBuffer.isView(data)
                    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
                    : data);
            if (!isKtx2Container(bytes)) throw new TypeError('TextureManager: invalid KTX2 identifier');
            const inspection = inspectKtx2TextureData(bytes, { supportedFeatures: device.features });
            if (!inspection.container.valid) {
                throw new TypeError(`TextureManager: invalid KTX2 container: ${inspection.container.issues.join(', ')}`);
            }
            const target = selectKtx2TargetFormat(device.features, {
                width: inspection.container.header.pixelWidth,
                height: inspection.container.header.pixelHeight,
                mipLevels: inspection.container.header.levelCount,
                depthOrArrayLayers: inspection.payloadPlan.depthOrArrayLayers,
                needsAlpha: options.needsAlpha !== false,
                colorSpace: options.colorSpace,
                semantic: options.semantic || options.usageClass,
                mobileOrApple: options.mobileOrApple,
            });
            const decoder = options.decodeKtx2Payload || options.transcodeKtx2 || ktx2Decoder;
            const uploaded = await createTextureFromKtx2DataWithDecoder(device, bytes, {
                label: options.label || `tex_${key}`,
                supportedFeatures: device.features,
                targetFormat: options.targetFormat || target.format,
                decodeKtx2Payload: decoder,
                colorSpace: options.colorSpace,
                semantic: options.semantic || options.usageClass,
            });
            const entry = {
                texture: uploaded.texture,
                view: uploaded.view,
                width: uploaded.width,
                height: uploaded.height,
                format: uploaded.format,
                mipLevelCount: uploaded.mipLevelCount,
                ktx2: uploaded.ktx2,
                transcodeTarget: target,
            };
            cache.set(key, entry);
            return entry;
        } catch (err) {
            if (options.strict) throw err;
            console.warn(`[TextureManager] Failed to load KTX2 "${key}":`, err.message);
            return _ktx2Fallback(options);
        }
    }

    function setKtx2Decoder(decoder) {
        if (decoder !== null && typeof decoder !== 'function') {
            throw new TypeError('TextureManager: KTX2 decoder must be a function or null');
        }
        ktx2Decoder = decoder;
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Load a texture from a URL or object URL path.
     * Returns cached result if already loaded.
     * @param {string} path - URL, blob URL, or data URL
     * @param {Object} [options]
     * @param {boolean} [options.flipY=false]
     * @param {string}  [options.label]
     * @returns {Promise<{texture: GPUTexture, view: GPUTextureView, width: number, height: number}>}
     */
    async function load(path, options = {}) {
        if (!path) return defaultWhite;

        const cacheKey = options.colorSpace ? `${path}#color-space=${options.colorSpace}` : path;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            if (_isKtx2Source(path, options) || blob.type === 'image/ktx2') {
                return loadKtx2(await blob.arrayBuffer(), cacheKey, options);
            }
            const bitmap = await createImageBitmap(blob, {
                premultiplyAlpha: 'none',
                colorSpaceConversion: 'none',
                imageOrientation: options.flipY ? 'flipY' : 'none',
            });
            const entry = _uploadBitmap(bitmap, options.label || `tex_${path}`, options);
            bitmap.close();
            cache.set(cacheKey, entry);
            console.log(`[TextureManager] Loaded: ${path} (${entry.width}×${entry.height})`);
            return entry;
        } catch (err) {
            console.warn(`[TextureManager] Failed to load "${path}":`, err.message);
            return defaultWhite;
        }
    }

    /**
     * Load a texture directly from a File or Blob object (for file picker / drag-drop).
     * @param {File|Blob} file
     * @param {string} [label]
     * @returns {Promise<{texture: GPUTexture, view: GPUTextureView, width: number, height: number}>}
     */
    async function loadFromFile(file, label) {
        if (!file) return defaultWhite;

        const cacheKey = `file://${file.name || 'blob'}_${file.size}_${file.lastModified || 0}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        try {
            if (_isKtx2Source(file)) {
                return loadKtx2(await file.arrayBuffer(), cacheKey, { label, fallback: defaultWhite });
            }
            const bitmap = await createImageBitmap(file, {
                premultiplyAlpha: 'none',
                colorSpaceConversion: 'none',
            });
            const entry = _uploadBitmap(bitmap, label || `tex_file_${file.name || 'blob'}`);
            bitmap.close();
            cache.set(cacheKey, entry);
            console.log(`[TextureManager] Loaded file: ${file.name} (${entry.width}×${entry.height})`);
            return entry;
        } catch (err) {
            console.warn(`[TextureManager] Failed to load file:`, err.message);
            return defaultWhite;
        }
    }

    /** Load a Blob under an explicit stable key, including color-space ownership. */
    async function loadFromBlob(blob, cacheKey, options = {}) {
        if (!blob) return defaultWhite;
        const key = String(cacheKey || 'blob');
        if (cache.has(key)) return cache.get(key);
        try {
            if (_isKtx2Source(blob, options)) {
                return loadKtx2(await blob.arrayBuffer(), key, options);
            }
            const bitmap = await createImageBitmap(blob, {
                premultiplyAlpha: 'none',
                colorSpaceConversion: 'none',
                imageOrientation: options.flipY ? 'flipY' : 'none',
            });
            const entry = _uploadBitmap(bitmap, options.label || `tex_${key}`, options);
            bitmap.close();
            cache.set(key, entry);
            return entry;
        } catch (err) {
            console.warn(`[TextureManager] Failed to load blob "${key}":`, err.message);
            return options.fallback || defaultWhite;
        }
    }

    /** Return a cached WebGPU sampler for an exact normalized descriptor. */
    function getSampler(descriptor = {}) {
        const minMode = descriptor.minFilter || 'linearMipmapLinear';
        const normalized = {
            magFilter: descriptor.magFilter === 'nearest' ? 'nearest' : 'linear',
            minFilter: minMode.startsWith('nearest') ? 'nearest' : 'linear',
            mipmapFilter: minMode.endsWith('Nearest') || minMode === 'nearest' || minMode === 'linear'
                ? 'nearest'
                : 'linear',
            addressModeU: ['clamp-to-edge', 'mirror-repeat', 'repeat'].includes(descriptor.wrapU)
                ? descriptor.wrapU
                : 'repeat',
            addressModeV: ['clamp-to-edge', 'mirror-repeat', 'repeat'].includes(descriptor.wrapV)
                ? descriptor.wrapV
                : 'repeat',
        };
        const key = JSON.stringify(normalized);
        if (!samplerCache.has(key)) samplerCache.set(key, device.createSampler(normalized));
        return samplerCache.get(key);
    }

    /**
     * Load a texture from an HTMLImageElement or HTMLCanvasElement.
     * @param {HTMLImageElement|HTMLCanvasElement} element
     * @param {string} [label]
     * @returns {Promise<{texture: GPUTexture, view: GPUTextureView, width: number, height: number}>}
     */
    async function loadFromElement(element, label) {
        try {
            const bitmap = await createImageBitmap(element, {
                premultiplyAlpha: 'none',
                colorSpaceConversion: 'none',
            });
            const entry = _uploadBitmap(bitmap, label || 'tex_element');
            bitmap.close();
            return entry;
        } catch (err) {
            console.warn(`[TextureManager] Failed to load element:`, err.message);
            return defaultWhite;
        }
    }

    /**
     * Generate a thumbnail (small canvas) for a loaded texture.
     * @param {string} path - Cache key used in load()
     * @param {number} [size=64] - Thumbnail dimension
     * @returns {HTMLCanvasElement|null}
     */
    function generateThumbnail(path, size = 64) {
        // Thumbnails are generated from cached bitmaps or by re-fetching
        // For now, return null — UI layer will handle thumbnail rendering
        return null;
    }

    /**
     * Check if a texture is cached.
     * @param {string} path
     * @returns {boolean}
     */
    function has(path) {
        return cache.has(path);
    }

    /**
     * Get a cached texture entry (or null).
     * @param {string} path
     * @returns {Object|null}
     */
    function get(path) {
        return cache.get(path) || null;
    }

    /**
     * Remove a texture from cache and destroy its GPU resource.
     * @param {string} path
     */
    function release(path) {
        const entry = cache.get(path);
        if (entry) {
            entry.texture.destroy();
            cache.delete(path);
        }
    }

    /**
     * Destroy all cached textures.
     */
    function dispose() {
        for (const entry of cache.values()) {
            try { entry.texture.destroy(); } catch (_) {}
        }
        cache.clear();
        // Don't destroy default textures — they may still be referenced
    }

    return {
        device,
        defaultSampler,
        clampSampler,
        defaultWhite,
        defaultBlack,
        defaultNormal,
        defaultMR,
        load,
        loadFromFile,
        loadFromBlob,
        loadKtx2,
        loadFromElement,
        setKtx2Decoder,
        getSampler,
        generateThumbnail,
        has,
        get,
        release,
        dispose,
        /** Number of cached textures */
        get size() { return cache.size; },
    };
}
