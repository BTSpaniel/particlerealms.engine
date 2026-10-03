// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioAssetManager.js - Audio Asset Loading & Caching
 * 
 * Fetches, decodes, and caches AudioBuffers. Supports pooling
 * and streaming for large files (music).
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an audio asset manager.
 * @param {AudioContext} context
 * @returns {Object} Asset manager instance
 */
export function createAudioAssetManager(context) {
  if (!context) return null;
  return {
    context,
    cache: new Map(),        // path → AudioBuffer
    pending: new Map(),      // path → Promise<AudioBuffer>
    baseUrl: '',             // Prefix for relative paths
  };
}

// ============================================================================
// LOADING
// ============================================================================

/**
 * Load and decode an audio file. Returns cached buffer if already loaded.
 * @param {Object} manager
 * @param {string} path - URL or relative path to audio file
 * @returns {Promise<AudioBuffer|null>}
 */
export async function loadAudioAsset(manager, path) {
  if (!manager || !path) return null;

  // Check cache
  const cached = manager.cache.get(path);
  if (cached) return cached;

  // Check pending
  const pending = manager.pending.get(path);
  if (pending) return pending;

  // Start loading
  const promise = _fetchAndDecode(manager, path);
  manager.pending.set(path, promise);

  try {
    const buffer = await promise;
    if (buffer) {
      manager.cache.set(path, buffer);
    }
    return buffer;
  } finally {
    manager.pending.delete(path);
  }
}

/**
 * Preload multiple audio assets.
 * @param {Object} manager
 * @param {string[]} paths
 * @returns {Promise<void>}
 */
export async function preloadAudioAssets(manager, paths) {
  if (!manager || !paths) return;
  await Promise.all(paths.map(p => loadAudioAsset(manager, p)));
}

/**
 * Register a pre-decoded AudioBuffer directly.
 * @param {Object} manager
 * @param {string} path - Key for retrieval
 * @param {AudioBuffer} buffer
 */
export function registerAudioBuffer(manager, path, buffer) {
  if (!manager || !path || !buffer) return;
  manager.cache.set(path, buffer);
}

/**
 * Get a cached buffer (synchronous).
 * @param {Object} manager
 * @param {string} path
 * @returns {AudioBuffer|null}
 */
export function getAudioBuffer(manager, path) {
  if (!manager) return null;
  return manager.cache.get(path) || null;
}

/**
 * Check if a buffer is cached.
 * @param {Object} manager
 * @param {string} path
 * @returns {boolean}
 */
export function hasAudioBuffer(manager, path) {
  if (!manager) return false;
  return manager.cache.has(path);
}

/**
 * Remove a cached buffer.
 * @param {Object} manager
 * @param {string} path
 */
export function unloadAudioAsset(manager, path) {
  if (!manager) return;
  manager.cache.delete(path);
}

/**
 * Clear all cached buffers.
 * @param {Object} manager
 */
export function clearAudioCache(manager) {
  if (!manager) return;
  manager.cache.clear();
}

/**
 * Set base URL for relative asset paths.
 * @param {Object} manager
 * @param {string} url
 */
export function setAudioBaseUrl(manager, url) {
  if (!manager) return;
  manager.baseUrl = url || '';
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy the asset manager and clear all caches.
 * @param {Object} manager
 */
export function destroyAudioAssetManager(manager) {
  if (!manager) return;
  manager.cache.clear();
  manager.pending.clear();
  manager.context = null;
}

// ============================================================================
// INTERNAL
// ============================================================================

async function _fetchAndDecode(manager, path) {
  try {
    const url = manager.baseUrl ? manager.baseUrl + '/' + path : path;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[AudioAssetManager] Failed to fetch: ${url} (${response.status})`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await manager.context.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } catch (err) {
    console.warn(`[AudioAssetManager] Failed to decode: ${path}`, err.message);
    return null;
  }
}

// Attach load method for convenience (used by AudioEngine)
const _proto = {
  load(path) { return loadAudioAsset(this, path); },
};

/**
 * @override createAudioAssetManager to attach convenience method
 */
const _origCreate = createAudioAssetManager;
export { _origCreate };
