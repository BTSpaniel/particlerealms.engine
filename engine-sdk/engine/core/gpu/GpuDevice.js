// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  DEFAULT_COLOR_FORMAT,
  DEFAULT_DEPTH_FORMAT,
  DEFAULT_SAMPLE_COUNT,
} from "./GpuFormats.js";
import { PipelineCache } from "./PipelineCache.js";
import { BufferPool } from "./BufferPool.js";
import { AsyncGPUWorkScheduler } from "./AsyncGPUWorkScheduler.js";
import { GpuFrameBudgetBroker } from "./GpuFrameBudgetBroker.js";

const GENERAL_OPTIONAL_FEATURES = Object.freeze([
  'timestamp-query',
  'shader-f16',
  'subgroups',
  'indirect-first-instance',
  'float32-filterable',
  'bgra8unorm-storage',
  'rg11b10ufloat-renderable',
  'texture-compression-bc',
  'texture-compression-etc2',
  'texture-compression-astc',
]);

function defineGpuCapabilityProfile(spec = {}) {
  return Object.freeze({
    requiredFeatures: Object.freeze([...(spec.requiredFeatures || [])]),
    optionalFeatures: Object.freeze([...(spec.optionalFeatures || [])]),
    minimumLimits: Object.freeze({ ...(spec.minimumLimits || {}) }),
    useDefaultLimits: spec.useDefaultLimits === true,
    featureLevel: spec.featureLevel || null,
    fallback: spec.fallback || null,
    modules: Object.freeze([...(spec.modules || [])]),
    verification: spec.verification || null,
  });
}

const BASELINE_RENDER_PROFILE = defineGpuCapabilityProfile({
  optionalFeatures: ['indirect-first-instance'],
  modules: ['engine/render', 'webgpu-os'],
  verification: 'baseline-render',
});

export const GPU_CAPABILITY_PROFILES = Object.freeze({
  default: BASELINE_RENDER_PROFILE,
  'baseline-render': BASELINE_RENDER_PROFILE,
  'legacy-max': defineGpuCapabilityProfile({
    optionalFeatures: GENERAL_OPTIONAL_FEATURES,
    useDefaultLimits: true,
    fallback: 'baseline-render',
    modules: ['legacy-standalone'],
    verification: 'legacy-max',
  }),
  'editor-workbench': defineGpuCapabilityProfile({
    optionalFeatures: [
      'timestamp-query', 'shader-f16', 'subgroups', 'indirect-first-instance',
      'texture-compression-bc', 'texture-compression-etc2', 'texture-compression-astc',
    ],
    fallback: 'baseline-render',
    modules: ['editor'],
    verification: 'editor-recovery',
  }),
  'particle-large-buffer': defineGpuCapabilityProfile({
    optionalFeatures: ['shader-f16', 'timestamp-query'],
    minimumLimits: {
      maxBufferSize: 512 * 1024 * 1024,
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxStorageBuffersPerShaderStage: 8,
    },
    fallback: 'chunked-particle-buffers',
    modules: ['engine/sim/particles'],
    verification: 'particle-large-buffer',
  }),
  'physx-flow': defineGpuCapabilityProfile({
    requiredFeatures: ['float32-filterable'],
    minimumLimits: {
      maxComputeInvocationsPerWorkgroup: 1024,
      maxComputeWorkgroupSizeX: 1024,
      maxStorageBuffersPerShaderStage: 11,
    },
    modules: ['engine/sim/PhysicsRuntime'],
    verification: 'gpu:flow-installed',
  }),
  'compressed-textures': defineGpuCapabilityProfile({
    optionalFeatures: ['texture-compression-bc', 'texture-compression-etc2', 'texture-compression-astc'],
    fallback: 'decoded-rgba',
    modules: ['engine/core/gpu/GpuTextureLoader'],
    verification: 'compressed-texture-matrix',
  }),
  'timestamp-profiling': defineGpuCapabilityProfile({
    optionalFeatures: ['timestamp-query'],
    fallback: 'cpu-queue-timing',
    modules: ['engine/core/gpu/GPUTimestampProfiler'],
    verification: 'timestamp-profile',
  }),
  'local-llm': defineGpuCapabilityProfile({
    optionalFeatures: ['shader-f16', 'subgroups', 'timestamp-query'],
    fallback: 'cpu-inference',
    modules: ['agi/llm'],
    verification: 'local-llm-fallback',
  }),
  'local-llm-f16-subgroups': defineGpuCapabilityProfile({
    requiredFeatures: ['shader-f16', 'subgroups'],
    optionalFeatures: ['timestamp-query'],
    fallback: 'local-llm',
    modules: ['agi/llm'],
    verification: 'local-llm-f16-subgroups',
  }),
  morphfield: defineGpuCapabilityProfile({
    optionalFeatures: ['shader-f16', 'subgroups', 'timestamp-query'],
    minimumLimits: { maxStorageBuffersPerShaderStage: 8, maxColorAttachments: 4 },
    fallback: 'morphfield-linear',
    modules: ['engine/morph'],
    verification: 'morphfield',
  }),
  'morphfield-wavefront': defineGpuCapabilityProfile({
    optionalFeatures: ['shader-f16', 'subgroups', 'timestamp-query'],
    minimumLimits: { maxStorageBuffersPerShaderStage: 8, maxColorAttachments: 4 },
    fallback: 'morphfield',
    modules: ['engine/morph'],
    verification: 'morphfield-wavefront',
  }),
  'voxel-64': defineGpuCapabilityProfile({
    modules: ['engine/voxel/SubChunkMeshCompute'],
    verification: 'voxel-64',
  }),
  'voxel-512': defineGpuCapabilityProfile({
    minimumLimits: { maxComputeInvocationsPerWorkgroup: 512 },
    fallback: 'voxel-64',
    modules: ['engine/voxel/SubChunkMeshCompute'],
    verification: 'voxel-512',
  }),
  'wide-gamut-presentation': defineGpuCapabilityProfile({
    fallback: 'baseline-render',
    modules: ['engine/core/gpu/GpuCanvas'],
    verification: 'display-p3-color-ramp',
  }),
  compatibility: defineGpuCapabilityProfile({
    featureLevel: 'compatibility',
    fallback: 'dom-shell',
    modules: ['webgpu-os', 'engine/compat'],
    verification: 'compatibility-adapter',
  }),
});

export function getGpuCapabilityProfile(profile = 'default') {
  const id = normalizeGpuDeviceProfile(profile);
  const spec = GPU_CAPABILITY_PROFILES[id];
  if (spec) return spec;
  const error = new Error(`Unknown WebGPU capability profile '${id}'`);
  error.code = 'GPU_PROFILE_UNKNOWN';
  error.profile = id;
  throw error;
}

/**
 * Detect GPU platform/browser for per-browser workarounds.
 *
 * WebGPU browser support (Feb 2026):
 *   Chrome/Edge 113+ — Win (D3D12), Mac (Metal), ChromeOS (Vulkan)
 *   Chrome 121+      — Android 12+ Qualcomm/ARM (Vulkan)
 *   Chrome 144+      — Linux Intel Gen12+ (Vulkan), expanding to AMD/NVIDIA
 *                       See: https://developer.chrome.com/blog/new-in-webgpu-144#webgpu_on_linux
 *   Firefox 141+     — Windows (wgpu/Rust backend)
 *   Firefox 145+     — macOS ARM64 (wgpu/Rust); Linux/Android expected 2026
 *   Safari 26+       — macOS Tahoe, iOS 26, iPadOS 26, visionOS 26 (Metal)
 *   Samsung Internet 24+ — Android (Chromium/Dawn)
 *
 * GPU API backends per OS (Chromium/Dawn):
 *   Windows  → D3D12     (SharedTextureMemory D3D11 swap chain bug)
 *   macOS    → Metal
 *   Linux    → Vulkan    (rest of Chromium stays on OpenGL)
 *   Android  → Vulkan    (OpenGL ES compat mode via Chrome 135+ flag)
 *   ChromeOS → Vulkan
 *
 * See: https://caniuse.com/webgpu
 *      https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
 */
export function detectGpuPlatform() {
  const ua = globalThis.navigator?.userAgent || '';
  const hasTouchDocument = typeof document !== 'undefined' && document && 'ontouchend' in document;
  const textureUsage = globalThis.GPUTextureUsage || {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    RENDER_ATTACHMENT: 0x10,
  };
  const isChromium = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (isSafari && hasTouchDocument);
  const isAndroid = /Android/.test(ua);
  const isMac = /Macintosh/.test(ua);
  const isWindows = /Windows/.test(ua);
  const isLinux = /Linux/.test(ua) && !isAndroid;
  const isChromeOS = /CrOS/.test(ua);

  // Extract version numbers
  const chromeVer = parseInt((ua.match(/Chrome\/(\d+)/) || [])[1]) || 0;
  const firefoxVer = parseInt((ua.match(/Firefox\/(\d+)/) || [])[1]) || 0;
  const safariVer = parseInt((ua.match(/Version\/(\d+)/) || [])[1]) || 0;

  // Implementation library: Dawn (Chromium C++) vs wgpu (Firefox Rust) vs WebKit
  let backend = 'unknown';
  if (isChromium || isEdge) backend = 'dawn';
  else if (isFirefox) backend = 'wgpu';
  else if (isSafari) backend = 'webkit';

  // GPU API: what native API does the browser talk to the driver through?
  // Chrome/Dawn: D3D12 (Win), Metal (Mac), Vulkan (Linux/Android/ChromeOS)
  // Firefox/wgpu: D3D12 (Win), Metal (Mac), Vulkan (Linux when shipped)
  // Safari/WebKit: Metal always
  let gpuApi = 'unknown';
  if (isSafari || isIOS) gpuApi = 'metal';
  else if (isWindows) gpuApi = 'd3d12';
  else if (isMac) gpuApi = 'metal';
  else if (isLinux || isAndroid || isChromeOS) gpuApi = 'vulkan';

  return {
    isChromium, isEdge, isFirefox, isSafari,
    isIOS, isAndroid, isMac, isWindows, isLinux, isChromeOS,
    chromeVer, firefoxVer, safariVer,
    backend,
    gpuApi,
    // Chrome 128+ supports event.preventDefault() in uncapturederror to suppress DevTools warnings
    supportsPreventDefaultUncaptured: (isChromium || isEdge) && chromeVer >= 128,
    // Chrome 140+: requestDevice() consumes the adapter (can't reuse)
    adapterConsumedByDevice: (isChromium || isEdge) && chromeVer >= 140,
    // SharedTextureMemory D3D11 bug is Windows-only (D3D12 backend uses D3D11 for swap chain)
    // Linux (Vulkan), Mac (Metal), Android (Vulkan) don't have this issue
    hasSharedTextureMemoryBug: (isChromium || isEdge) && isWindows,
    // Safari/Metal may not support COPY_DST on swapchain textures
    safeCanvasUsage: (isSafari || isIOS)
      ? textureUsage.RENDER_ATTACHMENT | textureUsage.COPY_SRC
      : textureUsage.RENDER_ATTACHMENT | textureUsage.COPY_SRC | textureUsage.COPY_DST,
  };
}

export class GpuDevice {
  constructor(adapter, device, acquisition = {}) {
    this.adapter = adapter;
    this.device = device;
    this.queue = device.queue;
    this.limits = device.limits || adapter.limits;
    // Adapter features describe what could have been requested. Device features
    // are the capabilities actually granted and legal to use in WGSL.
    this.features = device.features || new Set();
    this.adapterOptions = acquisition.adapterOptions || {};
    this.deviceDescriptor = acquisition.deviceDescriptor || {};
    this.profile = acquisition.profile || 'default';
    this.generation = acquisition.generation ?? 0;
    this.lost = false;
    this.lossInfo = null;
    this.destroyed = false;
    this._lostHandlers = new Set();
    
    this.pipelineCache = new PipelineCache(device, { generation: this.generation });
    this.bufferPool = new BufferPool(device, { maxPoolSize: 128 });
    this.workScheduler = new AsyncGPUWorkScheduler(device);
    this.frameBudgetBroker = new GpuFrameBudgetBroker({ device });

    this.maxTextureDimension2D = this.limits.maxTextureDimension2D || 8192;

    // Detect browser/platform for per-browser workarounds
    this.platform = detectGpuPlatform();

    // Cross-browser adapter info (Chrome 132+ adapter.info, older used requestAdapterInfo)
    this.adapterInfo = this._resolveAdapterInfo(adapter, device);
    const featureLevel = this.adapterOptions.featureLevel || 'core';
    const compatibilityMode = featureLevel === 'compatibility' || this.profile === 'compatibility';
    const workloadSupport = Object.freeze({
      domShell: true,
      simpleRender: true,
      advancedCompute: !compatibilityMode,
      voxel512: !compatibilityMode && Number(this.limits.maxComputeInvocationsPerWorkgroup) >= 512,
      largeStorageBuffers: !compatibilityMode
        && Number(this.limits.maxStorageBufferBindingSize) >= 128 * 1024 * 1024,
      localLlm: !compatibilityMode,
    });

    this.capabilities = {
      profile: this.profile,
      featureLevel,
      compatibilityMode,
      workloadSupport,
      limits: this.limits,
      features: this.features,
      defaultColorFormat: DEFAULT_COLOR_FORMAT,
      defaultDepthFormat: DEFAULT_DEPTH_FORMAT,
      defaultSampleCount: DEFAULT_SAMPLE_COUNT,
      platform: this.platform,
      adapterInfo: this.adapterInfo,
      safeCanvasUsage: this.platform.safeCanvasUsage,
    };

    // Global uncaptured error handler (WebGPU best practice — toji.dev/webgpu-best-practices/error-handling)
    // event.preventDefault() suppresses DevTools console warnings (Chrome 128+, may be no-op on Firefox/Safari).
    // See: https://developer.chrome.com/blog/new-in-webgpu-128
    if (this.device && typeof this.device.addEventListener === 'function') {
      this.device.addEventListener('uncapturederror', (event) => {
        const msg = event.error?.message || '';
        // Silently swallow Chrome-internal D3D11 swap chain / compositor errors (Windows only).
        // SharedTextureMemory / SharedImageD3D — texture lifecycle bug in Chrome's D3D11 swap chain.
        // D3DImageBacking / CanvasResourceRaster — canvas presentation errors during resize
        //   (Chrome internally CopyTextureToTexture's the old backing to the new one; old is destroyed).
        // These are Chromium compositor internals, not caused by app code. Harmless filter on other browsers.
        if (msg.includes('SharedTextureMemory') || msg.includes('SharedImageD3D')
            || msg.includes('D3DImageBacking') || msg.includes('CanvasResourceRaster')) {
          try { event.preventDefault(); } catch (_) {}
          return;
        }
        // Suppress DevTools warning (Chrome 128+) but re-surface to console for genuine app errors
        try { event.preventDefault(); } catch (_) {}
        console.warn('[GpuDevice] Uncaptured WebGPU error:', msg);
      });
    }

    if (this.device && this.device.lost) {
      this.device.lost.then((info) => {
        this._handleDeviceLoss(info);
      }).catch((error) => {
        console.error("GpuDevice lost promise error", error);
      });
    }
  }

  _handleDeviceLoss(info) {
    if (this.lost) return;
    this.lost = true;
    this.lossInfo = info || { reason: 'unknown', message: '' };
    invalidateCachedGpuDevice(this);
    for (const handler of this._lostHandlers) {
      try {
        handler(this.lossInfo);
      } catch (error) {
        console.error("GpuDevice lost handler error", error);
      }
    }
  }

  static async create(options = {}) {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) {
      throw new Error("WebGPU is not supported: navigator.gpu is not available");
    }

    const profileSpec = getGpuCapabilityProfile(options.profile);
    const adapterOptions = effectiveGpuAdapterOptions(options);
    const adapter = await gpu.requestAdapter(adapterOptions);
    if (!adapter) {
      throw new Error("WebGPU adapter not available");
    }

    const suppliedDescriptor = options.deviceDescriptor || null;
    let deviceDescriptor = suppliedDescriptor;
    let grantedFeatures = [];
    {
    // ========================================================================
    // OPTIONAL FEATURES - Request useful features if adapter supports them
    // Based on: https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html
    // ========================================================================
    
    // Features we'd like to have (but can work without)
    // A supplied descriptor is an exact recovery contract. Its already-granted
    // optional features are retained in requiredFeatures; do not silently add a
    // different optional set on a replacement adapter.
    const optionalFeatures = suppliedDescriptor ? [] : [
      ...(profileSpec.optionalFeatures || []),
      ...(options.optionalFeatures || []),
    ];
    
    // Features that are absolutely required (fail if not available)
    const requiredFeatures = [...new Set([
      ...(profileSpec.requiredFeatures || []),
      ...(options.requiredFeatures || []),
      ...(suppliedDescriptor?.requiredFeatures || []),
    ])];
    const missingRequired = [];
    for (const feature of requiredFeatures) {
      if (!adapter.features || !adapter.features.has(feature)) {
        missingRequired.push(feature);
      }
    }
    if (missingRequired.length > 0) {
      throw new Error(
        "Required WebGPU features not supported: " + missingRequired.join(", ")
      );
    }
    
    // Add optional features that are available
    const featureSet = new Set(requiredFeatures);
    for (const feature of optionalFeatures) {
      if (adapter.features && adapter.features.has(feature)) {
        featureSet.add(feature);
      }
    }
    grantedFeatures = [...featureSet];

    // ========================================================================
    // LIMITS - Request higher limits for voxel engine needs
    // Only request what we actually need, check adapter supports it first
    // ========================================================================
    
    const adapterLimits = adapter.limits || {};
    
    // Helper to request a limit up to adapter's max
    const requestLimit = (name, desired) => {
      const adapterMax = adapterLimits[name];
      if (adapterMax === undefined) return undefined;
      return Math.min(desired, adapterMax);
    };
    
    // Limits we need for voxel engine
    const defaultRequiredLimits = {};
    
    if (!suppliedDescriptor && profileSpec.useDefaultLimits !== false) {
    // Voxel meshing uses 512 invocations; PhysX PE Flow also has 1024-lane kernels.
    const workgroupLimit = requestLimit('maxComputeInvocationsPerWorkgroup', 1024);
    if (workgroupLimit) defaultRequiredLimits.maxComputeInvocationsPerWorkgroup = workgroupLimit;
    const workgroupXLimit = requestLimit('maxComputeWorkgroupSizeX', 1024);
    if (workgroupXLimit) defaultRequiredLimits.maxComputeWorkgroupSizeX = workgroupXLimit;
    
    // Storage buffer size: need large buffers for voxel data + neighbor grids (default is 128MB)
    const storageLimit = requestLimit('maxStorageBufferBindingSize', 1024 * 1024 * 1024); // up to 1GB
    if (storageLimit) defaultRequiredLimits.maxStorageBufferBindingSize = storageLimit;
    
    // Buffer size: NeighborGrid.cellEntries can exceed 512MB at 100k particles
    const bufferLimit = requestLimit('maxBufferSize', 1024 * 1024 * 1024); // up to 1GB
    if (bufferLimit) defaultRequiredLimits.maxBufferSize = bufferLimit;
    
    // Uniform buffer size: need larger uniforms for cascaded shadows, etc (default is 64KB)
    const uniformLimit = requestLimit('maxUniformBufferBindingSize', 64 * 1024); // 64KB (default)
    if (uniformLimit) defaultRequiredLimits.maxUniformBufferBindingSize = uniformLimit;
    
    // Bind groups: need 6+ for complex rendering (default is 4)
    const bindGroupLimit = requestLimit('maxBindGroups', 8);
    if (bindGroupLimit) defaultRequiredLimits.maxBindGroups = bindGroupLimit;

    // Flow point scans use eleven storage buffers; lower-capability adapters
    // still create their supported device and reject that emitter explicitly.
    const storageBuffersLimit = requestLimit('maxStorageBuffersPerShaderStage', 11);
    if (storageBuffersLimit) defaultRequiredLimits.maxStorageBuffersPerShaderStage = storageBuffersLimit;
    }

    // Compatibility adapters default vertex storage to zero even when hardware supports it.
    // Gaussian surfaces use three read-only vertex buffers; keep unsupported devices usable.
    const vertexStorageLimit = Number(adapterLimits.maxStorageBuffersInVertexStage);
    if (Number.isFinite(vertexStorageLimit) && vertexStorageLimit >= 3) {
      defaultRequiredLimits.maxStorageBuffersInVertexStage = Math.min(8, vertexStorageLimit);
    }
    const minimumLimits = profileSpec.minimumLimits || {};
    for (const [name, minimum] of Object.entries(minimumLimits)) {
      if (!Number.isFinite(Number(adapterLimits[name])) || Number(adapterLimits[name]) < minimum) {
        const error = new Error(`WebGPU profile '${options.profile || 'default'}' requires ${name} >= ${minimum}`);
        error.code = 'GPU_PROFILE_LIMIT_UNSUPPORTED';
        error.limit = name;
        error.minimum = minimum;
        error.available = adapterLimits[name];
        throw error;
      }
    }
    
    // Merge user-provided limits with defaults
    const requiredLimits = {
      ...defaultRequiredLimits,
      ...(suppliedDescriptor?.requiredLimits || {}),
      ...(options.requiredLimits || {}),
    };
    for (const [name, minimum] of Object.entries(minimumLimits)) {
      requiredLimits[name] = Math.max(Number(requiredLimits[name]) || 0, minimum);
    }
    for (const [name, required] of Object.entries(requiredLimits)) {
      const available = Number(adapterLimits[name]);
      if (!Number.isFinite(available) || available < Number(required)) {
        const error = new Error(`WebGPU device requires ${name} >= ${required}, adapter exposes ${adapterLimits[name] ?? 'none'}`);
        error.code = 'GPU_REQUIRED_LIMIT_UNSUPPORTED';
        error.limit = name;
        error.required = required;
        error.available = adapterLimits[name];
        throw error;
      }
    }

    // ========================================================================
    // REQUEST DEVICE
    // ========================================================================
    
    deviceDescriptor = {
      ...(suppliedDescriptor || {}),
      requiredFeatures: grantedFeatures,
      requiredLimits,
    };
    
    if (options.label) {
      deviceDescriptor.label = options.label;
    }
    }

    const device = await adapter.requestDevice(deviceDescriptor);
    if (!device) {
      throw new Error("WebGPU device not available");
    }
    
    // Log what we got for debugging
    if (options.verbose || options.label?.includes('ParticleRealms')) {
      console.log('[GpuDevice] Features granted:', grantedFeatures);
      console.log('[GpuDevice] Key limits:', {
        maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
        maxStorageBufferBindingSize: `${(device.limits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)}MB`,
        maxBufferSize: `${(device.limits.maxBufferSize / 1024 / 1024).toFixed(0)}MB`,
        maxBindGroups: device.limits.maxBindGroups,
        maxStorageBuffersPerShaderStage: device.limits.maxStorageBuffersPerShaderStage,
      });
    }
    
    const gpuDevice = new GpuDevice(adapter, device, {
      adapterOptions,
      deviceDescriptor,
      profile: options.profile || 'default',
      generation: options.generation ?? 0,
    });
    await Promise.resolve();
    if (gpuDevice.lost) {
      const error = new Error(gpuDevice.lossInfo?.message || "WebGPU device was lost during acquisition");
      error.code = 'GPU_DEVICE_LOST_DURING_ACQUISITION';
      error.info = gpuDevice.lossInfo;
      gpuDevice.destroy();
      throw error;
    }
    return gpuDevice;
  }

  /**
   * Resolve adapter info cross-browser.
   * Chrome 132+: adapter.info (property), device.adapterInfo
   * Chrome <131: adapter.requestAdapterInfo() (async, deprecated then removed)
   * Firefox 141+: adapter.info (follows spec)
   * Safari 26+: adapter.info (follows spec)
   */
  _resolveAdapterInfo(adapter, device) {
    // Prefer device.adapterInfo (Chrome 132+), then adapter.info (spec standard)
    const info = device?.adapterInfo || adapter?.info || null;
    if (info) {
      return {
        vendor: info.vendor || '',
        architecture: info.architecture || '',
        device: info.device || '',
        description: info.description || '',
      };
    }
    return { vendor: '', architecture: '', device: '', description: '' };
  }

  onDeviceLost(handler) {
    if (typeof handler !== "function") return;
    if (this.lost) {
      try { handler(this.lossInfo); }
      catch (error) { console.error("GpuDevice lost handler error", error); }
      return;
    }
    this._lostHandlers.add(handler);
  }

  removeDeviceLostHandler(handler) {
    this._lostHandlers.delete(handler);
  }

  getDevice() {
    return this.device;
  }

  getAdapter() {
    return this.adapter;
  }

  getAcquisitionOptions() {
    return {
      profile: this.profile,
      generation: this.generation,
      adapterOptions: this.adapterOptions,
      deviceDescriptor: this.deviceDescriptor,
    };
  }
  
  async initCache() {
    if (this.pipelineCache) {
      await this.pipelineCache.init();
      console.log('[GpuDevice] Pipeline cache initialized');
    }
  }
  
  getPipelineCache() {
    return this.destroyed ? null : this.pipelineCache;
  }
  
  getBufferPool() {
    return this.destroyed ? null : this.bufferPool;
  }
  
  getWorkScheduler() {
    return this.destroyed ? null : this.workScheduler;
  }

  getFrameBudgetBroker() {
    return this.destroyed ? null : this.frameBudgetBroker;
  }
  
  scheduleWork(commandBuffer, priority = 1) {
    if (this.destroyed) throw new Error('GpuDevice is destroyed');
    if (this.workScheduler) {
      return this.workScheduler.schedule(commandBuffer, priority);
    } else {
      this.queue.submit([commandBuffer]);
      return null;
    }
  }

  /** Schedule tick-stamped GPU work through the shared public job/fence path. */
  scheduleJob(commandBuffer, options = {}) {
    if (this.destroyed) throw new Error('GpuDevice is destroyed');
    if (this.workScheduler) return this.workScheduler.scheduleJob(commandBuffer, options);
    this.queue.submit([commandBuffer]);
    return null;
  }
  
  flushWork() {
    if (this.workScheduler) {
      this.workScheduler.flush();
    }
  }

  getQueue() {
    return this.queue;
  }

  getCapabilities() {
    return this.capabilities;
  }

  supportsWorkload(workload) {
    return this.capabilities.workloadSupport[String(workload)] === true;
  }

  requireWorkload(workload) {
    if (this.supportsWorkload(workload)) return true;
    const error = new Error(`WebGPU ${this.capabilities.featureLevel} profile does not admit workload '${workload}'`);
    error.code = 'GPU_WORKLOAD_UNSUPPORTED';
    error.profile = this.profile;
    error.featureLevel = this.capabilities.featureLevel;
    error.workload = String(workload);
    throw error;
  }

  /**
   * Gracefully destroy the GPU device and all associated resources.
   * After calling this, the device is unusable — device.lost will fire with reason='destroyed'.
   * Best practice: call before page unload or when switching to a new device after recovery.
   * See: https://toji.dev/webgpu-best-practices/device-loss.html
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    invalidateCachedGpuDevice(this);

    // Cancel scheduler-owned work before destroying the physical device. Pending
    // work must never be submitted into a generation that is being retired.
    if (this.pipelineCache && typeof this.pipelineCache.destroy === 'function') {
      try { this.pipelineCache.destroy(); } catch (_) {}
    }
    if (this.bufferPool && typeof this.bufferPool.destroy === 'function') {
      try { this.bufferPool.destroy(); } catch (_) {}
    }
    if (this.workScheduler && typeof this.workScheduler.destroy === 'function') {
      try { this.workScheduler.destroy(); } catch (_) {}
    }
    if (this.frameBudgetBroker && typeof this.frameBudgetBroker.destroy === 'function') {
      try { this.frameBudgetBroker.destroy(); } catch (_) {}
    }
    this.pipelineCache = null;
    this.bufferPool = null;
    this.workScheduler = null;
    this.frameBudgetBroker = null;

    // Clear device-lost handlers (we're destroying intentionally)
    this._lostHandlers.clear();

    // Destroy the GPU device — releases all GPU memory
    if (this.device && typeof this.device.destroy === 'function') {
      this.device.destroy();
    }

    this.device = null;
    this.queue = null;
    this.adapter = null;
    console.log('[GpuDevice] Destroyed');
  }
}

let gpuDeviceGeneration = 0;
const cachedGpuDevices = new Map();
const gpuDeviceAcquisitions = new Map();
const retainedGpuDeviceOptions = new Map();
const gpuDeviceRecoveries = new Map();
const gpuDeviceProfileEpochs = new Map();
const gpuDeviceRequestKeys = new WeakMap();

function normalizeGpuDeviceProfile(profile) {
  const value = profile ?? 'default';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && (typeof value.id === 'string' || typeof value.id === 'number')) return String(value.id);
  if (value && (typeof value.name === 'string' || typeof value.name === 'number')) return String(value.name);
  throw new TypeError('WebGPU device profile must be a string, number, or an object with an id/name');
}

function effectiveGpuAdapterOptions(options = {}) {
  const featureLevel = getGpuCapabilityProfile(options.profile).featureLevel;
  const adapterOptions = options.adapterOptions ? { ...options.adapterOptions } : {};
  if (featureLevel && adapterOptions.featureLevel === undefined) {
    adapterOptions.featureLevel = featureLevel;
  }
  return adapterOptions;
}

function orderedGpuRequestValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(orderedGpuRequestValue);
  return Object.fromEntries(Object.keys(value)
    .filter(key => key !== 'label' && value[key] !== undefined)
    .sort()
    .map(key => [key, orderedGpuRequestValue(value[key])]));
}

function hasGpuDeviceRequestOptions(options = {}) {
  return options.adapterOptions !== undefined
    || options.deviceDescriptor !== undefined
    || options.requiredFeatures !== undefined
    || options.requiredLimits !== undefined
    || options.optionalFeatures !== undefined;
}

function gpuDeviceRequestKey(options = {}) {
  const profileSpec = getGpuCapabilityProfile(options.profile);
  const suppliedDescriptor = options.deviceDescriptor || {};
  const requiredFeatures = [...new Set([
    ...(profileSpec.requiredFeatures || []),
    ...(suppliedDescriptor.requiredFeatures || []),
    ...(options.requiredFeatures || []),
  ])].sort();
  const requiredLimits = {
    ...(suppliedDescriptor.requiredLimits || {}),
    ...(options.requiredLimits || {}),
  };
  for (const [name, minimum] of Object.entries(profileSpec.minimumLimits || {})) {
    requiredLimits[name] = Math.max(Number(requiredLimits[name]) || 0, minimum);
  }
  const descriptor = {
    ...suppliedDescriptor,
    requiredFeatures,
    requiredLimits,
  };
  const optionalFeatures = options.deviceDescriptor
    ? []
    : [...new Set([
        ...(profileSpec.optionalFeatures || []),
        ...(options.optionalFeatures || []),
      ])].sort();
  return JSON.stringify({
    adapterOptions: orderedGpuRequestValue(effectiveGpuAdapterOptions(options)),
    deviceDescriptor: orderedGpuRequestValue(descriptor),
    optionalFeatures,
    usesDefaultLimits: !options.deviceDescriptor && profileSpec.useDefaultLimits !== false,
  });
}

function gpuDeviceProfileConflict(profile) {
  const error = new Error(`WebGPU device profile '${profile}' is already bound to incompatible acquisition options`);
  error.code = 'GPU_DEVICE_PROFILE_CONFLICT';
  return error;
}

function gpuDeviceIdentityKeys(gpuDevice, requestKey = null) {
  const keys = new Set();
  if (requestKey) keys.add(requestKey);
  const retainedKey = gpuDevice && gpuDeviceRequestKeys.get(gpuDevice);
  if (retainedKey) keys.add(retainedKey);
  const acquisitionOptions = gpuDevice?.getAcquisitionOptions?.();
  if (acquisitionOptions) {
    try { keys.add(gpuDeviceRequestKey(acquisitionOptions)); } catch (_) {}
  }
  return keys;
}

function recoveryIdentityKeys(options, requestedDevice, recoveryOptions) {
  const keys = new Set([gpuDeviceRequestKey(recoveryOptions)]);
  // With no explicit override, retain the request contract that originally
  // created the wrapper as well as its exact granted descriptor. The latter is
  // used for recovery; the former lets a stale wrapper safely join a newer
  // equivalent default-profile acquisition before its descriptor is known.
  if (!hasGpuDeviceRequestOptions(options)) {
    const retainedKey = requestedDevice && gpuDeviceRequestKeys.get(requestedDevice);
    if (retainedKey) keys.add(retainedKey);
  }
  return keys;
}

function gpuDeviceIdentitiesMatch(left, right) {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function retireRequestedGpuDevice(requestedDevice, authority, destroy) {
  if (!destroy || !requestedDevice || requestedDevice === authority) return;
  try { requestedDevice.destroy(); } catch (_) {}
}

function gpuDeviceProfileEpoch(profile) {
  return gpuDeviceProfileEpochs.get(profile) ?? 0;
}

function advanceGpuDeviceProfile(profile) {
  gpuDeviceGeneration += 1;
  gpuDeviceProfileEpochs.set(profile, gpuDeviceProfileEpoch(profile) + 1);
  cachedGpuDevices.delete(profile);
  gpuDeviceAcquisitions.delete(profile);
  gpuDeviceRecoveries.delete(profile);
  return gpuDeviceGeneration;
}

function advanceGpuDeviceGeneration() {
  gpuDeviceGeneration += 1;
  const profiles = new Set([
    ...cachedGpuDevices.keys(),
    ...gpuDeviceAcquisitions.keys(),
    ...gpuDeviceRecoveries.keys(),
  ]);
  for (const profile of profiles) {
    gpuDeviceProfileEpochs.set(profile, gpuDeviceProfileEpoch(profile) + 1);
  }
  cachedGpuDevices.clear();
  gpuDeviceAcquisitions.clear();
  gpuDeviceRecoveries.clear();
  return gpuDeviceGeneration;
}

function invalidateCachedGpuDevice(gpuDevice) {
  const profile = gpuDevice?.profile;
  const cached = profile == null ? null : cachedGpuDevices.get(profile);
  if (!cached || cached.gpuDevice !== gpuDevice || cached.generation !== gpuDevice.generation) {
    return false;
  }
  advanceGpuDeviceProfile(profile);
  return true;
}

function isCachedGpuDeviceValid(cached, profile) {
  return Boolean(
    cached
    && cached.profile === profile
    && cached.epoch === gpuDeviceProfileEpoch(profile)
    && cached.gpuDevice
    && !cached.gpuDevice.lost
    && !cached.gpuDevice.destroyed
    && cached.gpuDevice.getDevice()
  );
}

export function getGpuDeviceGeneration() {
  return gpuDeviceGeneration;
}

export function resetGpuDevice(options = {}) {
  const destroy = options.destroy === true;
  const devices = destroy
    ? [...new Set([...cachedGpuDevices.values()].map(entry => entry.gpuDevice).filter(Boolean))]
    : [];
  const generation = advanceGpuDeviceGeneration();
  if (destroy) {
    for (const gpuDevice of devices) {
      try { gpuDevice.destroy(); } catch (_) {}
    }
  }
  return generation;
}

export function getGpuDevice(options = {}) {
  const profile = normalizeGpuDeviceProfile(options.profile);
  const requestKey = gpuDeviceRequestKey(options);
  const profileEpoch = gpuDeviceProfileEpoch(profile);
  const cached = cachedGpuDevices.get(profile);
  if (isCachedGpuDeviceValid(cached, profile)) {
    if (hasGpuDeviceRequestOptions(options) && cached.requestKey !== requestKey) {
      return Promise.reject(gpuDeviceProfileConflict(profile));
    }
    return Promise.resolve(cached.gpuDevice);
  }
  if (cached) cachedGpuDevices.delete(profile);

  const active = gpuDeviceAcquisitions.get(profile);
  if (active && active.epoch === profileEpoch) {
    if (hasGpuDeviceRequestOptions(options) && active.requestKey !== requestKey) {
      return Promise.reject(gpuDeviceProfileConflict(profile));
    }
    return active.promise;
  }

  const generation = gpuDeviceGeneration;
  const createOptions = {
    ...options,
    profile,
    generation,
  };
  let acquisitionPromise;
  acquisitionPromise = GpuDevice.create(createOptions).then((gpuDevice) => {
    if (profileEpoch !== gpuDeviceProfileEpoch(profile)) {
      gpuDevice.destroy();
      const error = new Error('WebGPU device acquisition was invalidated by a generation change');
      error.code = 'GPU_DEVICE_ACQUISITION_STALE';
      throw error;
    }
    if (gpuDevice.lost || gpuDevice.destroyed || !gpuDevice.getDevice()) {
      const error = new Error(gpuDevice.lossInfo?.message || 'WebGPU device was lost during acquisition');
      error.code = 'GPU_DEVICE_LOST_DURING_ACQUISITION';
      error.info = gpuDevice.lossInfo;
      throw error;
    }
    gpuDeviceRequestKeys.set(gpuDevice, requestKey);
    cachedGpuDevices.set(profile, { profile, generation, epoch: profileEpoch, requestKey, gpuDevice });
    retainedGpuDeviceOptions.set(profile, gpuDevice.getAcquisitionOptions());
    return gpuDevice;
  }).finally(() => {
    if (gpuDeviceAcquisitions.get(profile)?.promise === acquisitionPromise) {
      gpuDeviceAcquisitions.delete(profile);
    }
  });
  gpuDeviceAcquisitions.set(profile, { generation, epoch: profileEpoch, requestKey, promise: acquisitionPromise });
  return acquisitionPromise;
}

export function recoverGpuDevice(options = {}) {
  const requestedDevice = options.gpuDevice || null;
  const profile = normalizeGpuDeviceProfile(options.profile ?? requestedDevice?.profile);
  const retained = requestedDevice?.getAcquisitionOptions?.()
    || cachedGpuDevices.get(profile)?.gpuDevice?.getAcquisitionOptions?.()
    || retainedGpuDeviceOptions.get(profile)
    || null;
  const adapterOptions = options.adapterOptions ?? retained?.adapterOptions;
  const deviceDescriptor = options.deviceDescriptor ?? retained?.deviceDescriptor;
  const recoveryOptions = {
    ...options,
    profile,
  };
  delete recoveryOptions.destroy;
  delete recoveryOptions.gpuDevice;
  if (adapterOptions !== undefined) recoveryOptions.adapterOptions = adapterOptions;
  if (deviceDescriptor !== undefined) recoveryOptions.deviceDescriptor = deviceDescriptor;
  const requestedIdentityKeys = recoveryIdentityKeys(options, requestedDevice, recoveryOptions);
  const profileEpoch = gpuDeviceProfileEpoch(profile);
  const cached = cachedGpuDevices.get(profile);

  // A caller can observe loss on A after a newer B has already become the
  // shared authority. Recovery of stale A must never evict or destroy B.
  if (requestedDevice && isCachedGpuDeviceValid(cached, profile)
      && cached.gpuDevice !== requestedDevice) {
    const currentIdentityKeys = gpuDeviceIdentityKeys(cached.gpuDevice, cached.requestKey);
    retireRequestedGpuDevice(requestedDevice, cached.gpuDevice, options.destroy === true);
    if (!gpuDeviceIdentitiesMatch(requestedIdentityKeys, currentIdentityKeys)) {
      return Promise.reject(gpuDeviceProfileConflict(profile));
    }
    return Promise.resolve(cached.gpuDevice);
  }

  const activeRecovery = gpuDeviceRecoveries.get(profile);
  if (activeRecovery?.epoch === profileEpoch) {
    retireRequestedGpuDevice(requestedDevice, null, options.destroy === true);
    if (!gpuDeviceIdentitiesMatch(requestedIdentityKeys, activeRecovery.identityKeys)) {
      return Promise.reject(gpuDeviceProfileConflict(profile));
    }
    return activeRecovery.promise;
  }

  // A current-epoch acquisition is already the next authority. Join it when
  // the stale recovery request has the same acquisition contract; otherwise
  // fail explicitly without invalidating either flight.
  const activeAcquisition = gpuDeviceAcquisitions.get(profile);
  if (activeAcquisition?.epoch === profileEpoch) {
    retireRequestedGpuDevice(requestedDevice, null, options.destroy === true);
    if (!requestedIdentityKeys.has(activeAcquisition.requestKey)) {
      return Promise.reject(gpuDeviceProfileConflict(profile));
    }
    return activeAcquisition.promise;
  }

  const cachedDevice = cached?.gpuDevice || null;
  const generation = advanceGpuDeviceProfile(profile);
  if (options.destroy === true) {
    for (const gpuDevice of new Set([requestedDevice, cachedDevice])) {
      if (!gpuDevice) continue;
      try { gpuDevice.destroy(); } catch (_) {}
    }
  }

  let recoveryPromise;
  recoveryPromise = getGpuDevice(recoveryOptions).finally(() => {
    if (gpuDeviceRecoveries.get(profile)?.promise === recoveryPromise) {
      gpuDeviceRecoveries.delete(profile);
    }
  });
  gpuDeviceRecoveries.set(profile, {
    epoch: gpuDeviceProfileEpoch(profile),
    generation,
    identityKeys: requestedIdentityKeys,
    promise: recoveryPromise,
  });
  return recoveryPromise;
}
