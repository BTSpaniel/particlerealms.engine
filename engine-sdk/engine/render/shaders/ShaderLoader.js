// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ShaderSources } from "./ShaderSources.js";

const shaderCache = new Map();

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    return "";
  }
  if (baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1);
  }
  return baseUrl;
}

async function fetchText(url) {
  if (shaderCache.has(url)) {
    return shaderCache.get(url);
  }

  if (typeof fetch !== "function") {
    throw new Error("ShaderLoader: fetch is not available in this environment");
  }

  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ShaderLoader: failed to load WGSL module '${url}' (${response.status})`);
    }
    return await response.text();
  })();

  shaderCache.set(url, promise);
  return promise;
}

/**
 * Try to load shader from JS sources first, fall back to fetch if not found.
 */
function tryLoadFromSources(key) {
  const code = ShaderSources[key];
  if (code) {
    return Promise.resolve(code);
  }
  return null;
}

export function createShaderLoader(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || "");

  function resolvePath(subPath) {
    if (!subPath.startsWith("/")) {
      return `${baseUrl}/${subPath}`;
    }
    return `${baseUrl}${subPath}`;
  }

  function loadRaw(path) {
    const url = resolvePath(path);
    return fetchText(url);
  }

  function loadCore(name) {
    // Try JS sources first
    const cached = tryLoadFromSources(`core/${name}`);
    if (cached) return cached;
    // Fall back to fetch
    return loadRaw(`core/${name}.wgsl`);
  }

  function loadMaterial(name) {
    const cached = tryLoadFromSources(`materials/${name}`);
    if (cached) return cached;
    return loadRaw(`materials/${name}.wgsl`);
  }

  function loadPostfx(name) {
    const cached = tryLoadFromSources(`postfx/${name}`);
    if (cached) return cached;
    return loadRaw(`postfx/${name}.wgsl`);
  }

  function loadDebug(name) {
    const cached = tryLoadFromSources(`debug/${name}`);
    if (cached) return cached;
    return loadRaw(`debug/${name}.wgsl`);
  }

  return {
    baseUrl,
    loadRaw,
    loadCore,
    loadMaterial,
    loadPostfx,
    loadDebug,
  };
}
