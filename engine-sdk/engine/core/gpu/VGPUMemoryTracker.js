// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { detectWasmSimd, detectWasmThreads } from '../compute/WasmCapabilities.js';

/**
 * Memory Budget Tracker - Track GPU memory usage, warn on budget exceeded
 * Also provides GPU memory probing to detect available VRAM
 */

import { textureFormatMipByteSize } from '../math/TextureMath.js';

const DEVICE_HOOKS = new WeakMap();
const RESOURCE_HOOKS = new WeakMap();
const LEGACY_OWNER_ID = 'legacy';

function installMethodHook(target, methodName, wrapper) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(target, methodName);
    if (ownDescriptor && (!('value' in ownDescriptor) || ownDescriptor.writable === false)) {
        return null;
    }

    const descriptor = ownDescriptor
        ? { ...ownDescriptor, value: wrapper }
        : { configurable: true, enumerable: false, writable: true, value: wrapper };
    Object.defineProperty(target, methodName, descriptor);
    return ownDescriptor || null;
}

function restoreMethodHook(target, methodName, wrapper, ownDescriptor) {
    if (target[methodName] !== wrapper) return;
    if (ownDescriptor) {
        Object.defineProperty(target, methodName, ownDescriptor);
    } else {
        delete target[methodName];
    }
}

function installResourceDestroyHook(resource, tracker) {
    if (!resource || typeof resource.destroy !== 'function') return;

    let state = RESOURCE_HOOKS.get(resource);
    if (!state) {
        const originalDestroy = resource.destroy;
        state = {
            originalDestroy,
            ownDescriptor: null,
            trackers: new Set(),
            destroyed: false,
            wrapper: null,
        };
        state.wrapper = function(...args) {
            if (!state.destroyed) {
                state.destroyed = true;
                for (const activeTracker of [...state.trackers]) {
                    activeTracker.untrack(resource);
                    activeTracker._hookedResources.delete(resource);
                }
                state.trackers.clear();
                RESOURCE_HOOKS.delete(resource);
                restoreMethodHook(resource, 'destroy', state.wrapper, state.ownDescriptor);
            }
            return Reflect.apply(state.originalDestroy, this, args);
        };
        state.ownDescriptor = installMethodHook(resource, 'destroy', state.wrapper);
        if (resource.destroy !== state.wrapper) return;
        RESOURCE_HOOKS.set(resource, state);
    }

    state.trackers.add(tracker);
    tracker._hookedResources.add(resource);
}

function removeResourceDestroyHook(resource, tracker) {
    const state = RESOURCE_HOOKS.get(resource);
    if (!state) return;
    state.trackers.delete(tracker);
    tracker._hookedResources.delete(resource);
    if (state.trackers.size > 0 || state.destroyed) return;
    restoreMethodHook(resource, 'destroy', state.wrapper, state.ownDescriptor);
    RESOURCE_HOOKS.delete(resource);
}

export class VGPUMemoryTracker {
    constructor(vgpu, options = {}) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        
        // GPU capabilities from adapter/device limits
        this._gpuInfo = null;
        this._probedVRAM = null;
        this._probing = false;
        
        // Budget limits (in bytes) - will be updated after probing
        this.budgets = {
            buffer: options.bufferBudget || 4 * 1024 * 1024 * 1024,   // 4 GB
            texture: options.textureBudget || 2 * 1024 * 1024 * 1024, // 2 GB
            total: options.totalBudget || 8 * 1024 * 1024 * 1024,     // 8 GB
        };
        
        // Throttle warning logs (max once per 5s per type)
        this._lastWarningTime = {};
        
        // Initialize GPU info from limits
        this._initGPUInfo();
        
        // Warning thresholds (0-1)
        this.warningThreshold = options.warningThreshold || 0.8;
        this.criticalThreshold = options.criticalThreshold || 0.95;
        
        // Current usage tracking
        this._usage = {
            buffer: 0,
            texture: 0,
            total: 0,
        };
        
        // Resource registry
        this._resources = new Map();  // resource -> { type, size, label, created, ownerId }
        this._nextId = 0;
        this._ownerUsage = new Map();
        this._ownerStack = [];
        this._hookedResources = new Set();
        this._monitorIntervals = new Set();
        this._idleMeasurements = new Set();
        this._timingHelpers = new Set();
        this._destroyed = false;
        this._deviceHookState = null;
        this._probeGeneration = 0;
        this._probeBuffers = new Set();
        this._ramProbeCollections = new Set();
        
        // Incremental counts (avoid iterating _resources in getUsage)
        this._counts = { buffer: 0, texture: 0 };
        
        // Reusable result object for getUsage() (avoid GC pressure)
        this._usageResult = { buffer: 0, texture: 0, total: 0, bufferCount: 0, textureCount: 0, bufferPercent: '0.0', texturePercent: '0.0', totalPercent: '0.0' };
        
        // History for trending (ring buffer to avoid shift() O(n))
        this._history = new Array(60);
        this._historyMaxLength = 60;
        this._historyIndex = 0;
        this._historyCount = 0;
        
        // Callbacks
        this._onWarning = options.onWarning || null;
        this._onCritical = options.onCritical || null;
        this._onOverBudget = options.onOverBudget || null;
        
        // Stats
        this._stats = {
            peakBuffer: 0,
            peakTexture: 0,
            peakTotal: 0,
            allocations: 0,
            deallocations: 0,
            warningCount: 0,
        };
        
        // Auto-intercept device.createBuffer/createTexture for universal tracking.
        // The realm installs one shared, reversible hook per exact GPUDevice.
        this._installDeviceHooks();
    }
    
    /**
     * Wrap device.createBuffer and device.createTexture so ALL allocations
     * are tracked automatically, even from code that bypasses VirtualGPU.
     */
    _installDeviceHooks() {
        const device = this.device;
        if (!device || typeof device.createBuffer !== 'function' || typeof device.createTexture !== 'function') return;

        let state = DEVICE_HOOKS.get(device);
        if (!state) {
            state = {
                trackers: new Set(),
                createBuffer: device.createBuffer,
                createTexture: device.createTexture,
                createBufferDescriptor: null,
                createTextureDescriptor: null,
                wrappedCreateBuffer: null,
                wrappedCreateTexture: null,
            };

            state.wrappedCreateBuffer = function(...args) {
                const buffer = Reflect.apply(state.createBuffer, this, args);
                const descriptor = args[0] || {};
                const label = descriptor.label || '';
                if (!label.startsWith('vram_probe') && !label.startsWith('vram_fill') && !label.startsWith('ram_probe')) {
                    for (const activeTracker of [...state.trackers]) {
                        activeTracker._autoTrack(buffer, 'buffer', descriptor.size || 0, label, descriptor);
                    }
                }
                return buffer;
            };
            state.wrappedCreateTexture = function(...args) {
                const texture = Reflect.apply(state.createTexture, this, args);
                const descriptor = args[0] || {};
                for (const activeTracker of [...state.trackers]) {
                    const size = activeTracker._calculateTextureSizeFromDescriptor(descriptor);
                    activeTracker._autoTrack(texture, 'texture', size, descriptor.label || '', descriptor);
                }
                return texture;
            };

            state.createBufferDescriptor = installMethodHook(device, 'createBuffer', state.wrappedCreateBuffer);
            state.createTextureDescriptor = installMethodHook(device, 'createTexture', state.wrappedCreateTexture);
            if (device.createBuffer !== state.wrappedCreateBuffer || device.createTexture !== state.wrappedCreateTexture) {
                restoreMethodHook(device, 'createBuffer', state.wrappedCreateBuffer, state.createBufferDescriptor);
                restoreMethodHook(device, 'createTexture', state.wrappedCreateTexture, state.createTextureDescriptor);
                return;
            }
            DEVICE_HOOKS.set(device, state);
        }

        state.trackers.add(this);
        this._deviceHookState = state;
    }
    
    /**
     * Auto-track a resource (skip if already tracked via explicit trackBuffer/trackTexture)
     */
    _autoTrack(resource, type, size, label, descriptor = null) {
        if (this._destroyed || this._resources.has(resource)) return;
        this._track(resource, type, size, label, this.currentOwnerId, descriptor);
        installResourceDestroyHook(resource, this);
    }

    /**
     * Register a buffer allocation
     * @param {GPUBuffer} buffer - The GPU buffer
     * @param {string} [label] - Optional label for debugging
     * @returns {number} Resource ID
     */
    trackBuffer(buffer, label = '', ownerId = this.currentOwnerId) {
        if (this._destroyed) return -1;
        if (this._resources.has(buffer)) {
            const info = this._resources.get(buffer);
            if (label) info.label = label;
            return info.id;
        }
        const size = buffer.size;
        const id = this._track(buffer, 'buffer', size, label, ownerId);
        installResourceDestroyHook(buffer, this);
        return id;
    }

    /**
     * Register a texture allocation
     * @param {GPUTexture} texture - The GPU texture
     * @param {string} [label] - Optional label for debugging
     * @returns {number} Resource ID
     */
    trackTexture(texture, label = '', descriptor = null, ownerId = this.currentOwnerId) {
        if (this._destroyed) return -1;
        if (this._resources.has(texture)) {
            const info = this._resources.get(texture);
            if (label) info.label = label;
            return info.id;
        }
        const size = descriptor ? this._calculateTextureSizeFromDescriptor(descriptor) : this._calculateTextureSize(texture);
        const id = this._track(texture, 'texture', size, label, ownerId, descriptor);
        installResourceDestroyHook(texture, this);
        return id;
    }

    /**
     * Unregister a resource
     * @param {GPUBuffer|GPUTexture} resource - The resource to untrack
     */
    untrack(resource) {
        const info = this._resources.get(resource);
        if (!info) return;
        
        this._usage[info.type] -= info.size;
        this._usage.total -= info.size;
        if (info.type === 'buffer') this._counts.buffer--; else if (info.type === 'texture') this._counts.texture--;
        this._adjustOwnerUsage(info.ownerId, info.type, -info.size, -1);
        this._resources.delete(resource);
        this._stats.deallocations++;
        removeResourceDestroyHook(resource, this);
    }

    get currentOwnerId() {
        return this._ownerStack[this._ownerStack.length - 1] || LEGACY_OWNER_ID;
    }

    withOwnerScope(ownerId, operation) {
        if (typeof operation !== 'function') {
            throw new TypeError('[VGPUMemoryTracker] Owner-scoped operation must be a function');
        }
        const normalizedOwnerId = String(ownerId || '').trim();
        if (!normalizedOwnerId) {
            throw new TypeError('[VGPUMemoryTracker] ownerId must be a non-empty string');
        }
        if (this._destroyed) {
            throw new Error('[VGPUMemoryTracker] Tracker is destroyed');
        }

        this._ownerStack.push(normalizedOwnerId);
        try {
            return operation();
        } finally {
            this._ownerStack.pop();
        }
    }

    _track(resource, type, size, label, ownerId = this.currentOwnerId, descriptor = null) {
        if (this._destroyed) return -1;
        const normalizedSize = Number.isFinite(size) && size > 0 ? Math.ceil(size) : 0;
        const normalizedOwnerId = String(ownerId || LEGACY_OWNER_ID);
        const id = this._nextId++;
        const info = {
            id,
            type,
            size: normalizedSize,
            label: label || `${type}_${id}`,
            created: performance.now(),
            ownerId: normalizedOwnerId,
            descriptor,
        };
        
        this._resources.set(resource, info);
        this._usage[type] += normalizedSize;
        this._usage.total += normalizedSize;
        this._adjustOwnerUsage(normalizedOwnerId, type, normalizedSize, 1);
        this._stats.allocations++;
        if (type === 'buffer') this._counts.buffer++; else if (type === 'texture') this._counts.texture++;
        
        // Update peaks
        this._stats.peakBuffer = Math.max(this._stats.peakBuffer, this._usage.buffer);
        this._stats.peakTexture = Math.max(this._stats.peakTexture, this._usage.texture);
        this._stats.peakTotal = Math.max(this._stats.peakTotal, this._usage.total);
        
        // Check thresholds
        this._checkThresholds(type);
        
        return id;
    }

    _adjustOwnerUsage(ownerId, type, sizeDelta, countDelta) {
        let usage = this._ownerUsage.get(ownerId);
        if (!usage) {
            usage = { buffer: 0, texture: 0, total: 0, bufferCount: 0, textureCount: 0 };
            this._ownerUsage.set(ownerId, usage);
        }
        usage[type] = Math.max(0, usage[type] + sizeDelta);
        usage.total = Math.max(0, usage.total + sizeDelta);
        const countKey = type === 'buffer' ? 'bufferCount' : 'textureCount';
        usage[countKey] = Math.max(0, usage[countKey] + countDelta);
        if (usage.total === 0 && usage.bufferCount === 0 && usage.textureCount === 0) {
            this._ownerUsage.delete(ownerId);
        }
    }

    _checkThresholds(type) {
        const usage = this._usage[type];
        const budget = this.budgets[type];
        const ratio = usage / budget;
        
        // Throttle: max one log per type per 5 seconds
        const now = performance.now();
        const lastWarn = this._lastWarningTime[type];
        const canLog = lastWarn === undefined || (now - lastWarn) > 5000;
        
        if (!canLog) return; // Throttle everything: logs + callbacks
        
        if (ratio >= 1.0) {
            this._stats.warningCount++;
            this._lastWarningTime[type] = now;
            if (this._onOverBudget) this._onOverBudget(type, usage, budget);
            console.warn(`[MemoryTracker] OVER BUDGET: ${type} at ${this._formatBytes(usage)} / ${this._formatBytes(budget)}`);
        } else if (ratio >= this.criticalThreshold) {
            this._stats.warningCount++;
            this._lastWarningTime[type] = now;
            if (this._onCritical) this._onCritical(type, usage, budget);
            console.warn(`[MemoryTracker] CRITICAL: ${type} at ${(ratio * 100).toFixed(1)}%`);
        } else if (ratio >= this.warningThreshold) {
            this._lastWarningTime[type] = now;
            if (this._onWarning) this._onWarning(type, usage, budget);
        }
        
        // Also check total
        if (type !== 'total') {
            this._checkThresholds('total');
        }
    }

    /**
     * Update per-frame (for history tracking)
     */
    update() {
        const idx = this._historyIndex;
        let entry = this._history[idx];
        if (!entry) {
            entry = { buffer: 0, texture: 0, total: 0, timestamp: 0 };
            this._history[idx] = entry;
        }
        entry.buffer = this._usage.buffer;
        entry.texture = this._usage.texture;
        entry.total = this._usage.total;
        entry.timestamp = performance.now();
        this._historyIndex = (idx + 1) % this._historyMaxLength;
        if (this._historyCount < this._historyMaxLength) this._historyCount++;
    }

    /**
     * Get current memory usage (reuses cached object to avoid GC pressure)
     */
    getUsage() {
        const r = this._usageResult;
        r.buffer = this._usage.buffer;
        r.texture = this._usage.texture;
        r.total = this._usage.total;
        r.bufferCount = this._counts.buffer;
        r.textureCount = this._counts.texture;
        r.bufferPercent = (this._usage.buffer / this.budgets.buffer * 100).toFixed(1);
        r.texturePercent = (this._usage.texture / this.budgets.texture * 100).toFixed(1);
        r.totalPercent = (this._usage.total / this.budgets.total * 100).toFixed(1);
        return r;
    }

    getUsageForOwner(ownerId) {
        const normalizedOwnerId = String(ownerId || LEGACY_OWNER_ID);
        const usage = this._ownerUsage.get(normalizedOwnerId);
        if (!usage) {
            return {
                ownerId: normalizedOwnerId,
                buffer: 0,
                texture: 0,
                total: 0,
                bufferCount: 0,
                textureCount: 0,
            };
        }
        return { ownerId: normalizedOwnerId, ...usage };
    }

    releaseOwner(ownerId) {
        const normalizedOwnerId = String(ownerId || LEGACY_OWNER_ID);
        const ownedResources = [];
        for (const [resource, info] of this._resources) {
            if (info.ownerId === normalizedOwnerId) ownedResources.push(resource);
        }
        for (const resource of ownedResources) this.untrack(resource);
        return ownedResources.length;
    }

    /**
     * Get formatted usage string
     */
    getUsageString() {
        const u = this.getUsage();
        return `Buffers: ${this._formatBytes(u.buffer)} (${u.bufferPercent}%) | ` +
               `Textures: ${this._formatBytes(u.texture)} (${u.texturePercent}%) | ` +
               `Total: ${this._formatBytes(u.total)} (${u.totalPercent}%)`;
    }

    /**
     * Get detailed stats
     */
    getStats() {
        return {
            ...this._stats,
            currentUsage: this.getUsage(),
            resourceCount: this._resources.size,
            budgets: { ...this.budgets },
            owners: this._ownerUsage.size,
        };
    }

    /**
     * Get largest resources (for debugging leaks)
     * @param {number} count - Number of resources to return
     * @param {string} [type] - Filter by type ('buffer' or 'texture')
     */
    getLargestResources(count = 10, type = null) {
        const resources = [];
        for (const [resource, info] of this._resources) {
            if (!type || info.type === type) {
                resources.push({ resource, ...info });
            }
        }
        
        return resources
            .sort((a, b) => b.size - a.size)
            .slice(0, count)
            .map(r => ({
                label: r.label,
                type: r.type,
                size: this._formatBytes(r.size),
                sizeBytes: r.size,
                age: ((performance.now() - r.created) / 1000).toFixed(1) + 's',
            }));
    }

    /**
     * Get memory usage trend (increasing/decreasing/stable)
     */
    getTrend() {
        if (this._historyCount < 10) return 'unknown';
        
        // Read from ring buffer: oldest of last 10 and newest
        const newest = (this._historyIndex - 1 + this._historyMaxLength) % this._historyMaxLength;
        const oldest = (this._historyIndex - Math.min(10, this._historyCount) + this._historyMaxLength) % this._historyMaxLength;
        const first = this._history[oldest]?.total || 0;
        const last = this._history[newest]?.total || 0;
        if (first === 0) return 'unknown';
        const change = (last - first) / first;
        
        if (change > 0.1) return 'increasing';
        if (change < -0.1) return 'decreasing';
        return 'stable';
    }

    /**
     * Find potential memory leaks (resources older than threshold with no recent access)
     * @param {number} ageThresholdMs - Age threshold in milliseconds
     */
    findPotentialLeaks(ageThresholdMs = 60000) {
        const now = performance.now();
        const suspects = [];
        
        for (const [resource, info] of this._resources) {
            const age = now - info.created;
            if (age > ageThresholdMs && info.size > 1024 * 1024) { // >1MB and old
                suspects.push({
                    label: info.label,
                    type: info.type,
                    size: this._formatBytes(info.size),
                    sizeBytes: info.size,
                    age: (age / 1000).toFixed(1) + 's',
                });
            }
        }
        
        return suspects.sort((a, b) => b.sizeBytes - a.sizeBytes);
    }

    /**
     * Set callback for warning threshold
     */
    setWarningCallback(callback) {
        this._onWarning = callback;
    }

    /**
     * Set callback for critical threshold
     */
    setCriticalCallback(callback) {
        this._onCritical = callback;
    }

    /**
     * Set callback for over-budget
     */
    setOverBudgetCallback(callback) {
        this._onOverBudget = callback;
    }

    /**
     * Reset all tracking
     */
    reset() {
        for (const resource of [...this._hookedResources]) {
            removeResourceDestroyHook(resource, this);
        }
        this._resources.clear();
        this._ownerUsage.clear();
        this._ownerStack.length = 0;
        this._usage = { buffer: 0, texture: 0, total: 0 };
        this._history = new Array(this._historyMaxLength);
        this._historyIndex = 0;
        this._historyCount = 0;
        this._counts = { buffer: 0, texture: 0 };
        this._stats = {
            peakBuffer: 0,
            peakTexture: 0,
            peakTotal: 0,
            allocations: 0,
            deallocations: 0,
            warningCount: 0,
        };
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._probeGeneration++;

        for (const buffer of this._probeBuffers) {
            try { buffer?.destroy?.(); } catch (_) {}
        }
        this._probeBuffers.clear();
        for (const chunks of this._ramProbeCollections) chunks.length = 0;
        this._ramProbeCollections.clear();

        for (const intervalId of this._monitorIntervals) clearInterval(intervalId);
        this._monitorIntervals.clear();
        for (const handle of this._idleMeasurements) {
            if (typeof globalThis.cancelIdleCallback === 'function') {
                globalThis.cancelIdleCallback(handle);
            } else {
                clearTimeout(handle);
            }
        }
        this._idleMeasurements.clear();
        for (const helper of [...this._timingHelpers]) {
            try { helper.destroy(); } catch (_) {}
        }
        this._timingHelpers.clear();

        this.reset();
        const state = this._deviceHookState;
        if (state) {
            state.trackers.delete(this);
            if (state.trackers.size === 0) {
                restoreMethodHook(this.device, 'createBuffer', state.wrappedCreateBuffer, state.createBufferDescriptor);
                restoreMethodHook(this.device, 'createTexture', state.wrappedCreateTexture, state.createTextureDescriptor);
                DEVICE_HOOKS.delete(this.device);
            }
        }
        this._deviceHookState = null;
        this._onWarning = null;
        this._onCritical = null;
        this._onOverBudget = null;
        this.vgpu = null;
    }

    _calculateTextureSize(texture) {
        const width = typeof texture?.width === 'number' ? texture.width : 1;
        const height = typeof texture?.height === 'number' ? texture.height : 1;
        const depthOrArrayLayers = typeof texture?.depthOrArrayLayers === 'number' ? texture.depthOrArrayLayers : 1;
        const format = typeof texture?.format === 'string' ? texture.format : 'rgba8unorm';
        const mipLevelCount = typeof texture?.mipLevelCount === 'number' ? texture.mipLevelCount : 1;
        
        const totalSize = textureFormatMipByteSize(width, height, format, mipLevelCount, depthOrArrayLayers);
        
        
        return Math.ceil(totalSize);
    }

    _calculateTextureSizeFromDescriptor(descriptor) {
        const size = descriptor?.size;
        const width = typeof size?.width === 'number' ? size.width : (Array.isArray(size) ? size[0] : 1);
        const height = typeof size?.height === 'number' ? size.height : (Array.isArray(size) ? size[1] : 1);
        const depthOrArrayLayers = typeof size?.depthOrArrayLayers === 'number'
            ? size.depthOrArrayLayers
            : (Array.isArray(size) ? (size[2] ?? 1) : 1);

        const format = typeof descriptor?.format === 'string' ? descriptor.format : 'rgba8unorm';
        const mipLevelCount = typeof descriptor?.mipLevelCount === 'number' ? descriptor.mipLevelCount : 1;
        const sampleCount = typeof descriptor?.sampleCount === 'number' ? descriptor.sampleCount : 1;

        let totalSize = textureFormatMipByteSize(width, height, format, mipLevelCount, depthOrArrayLayers);

        totalSize *= sampleCount;
        return Math.ceil(totalSize);
    }

    _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    
    // ========================================================================
    // GPU INFO & VRAM PROBING
    // ========================================================================
    
    /**
     * Initialize GPU info from device/adapter limits
     */
    _initGPUInfo() {
        // Access the GpuDevice wrapper from VirtualGPU
        const gpuDevice = this.vgpu.gpuDevice;
        const limits = this.vgpu.limits || gpuDevice?.limits || {};
        const adapter = this.vgpu.adapter || gpuDevice?.adapter;
        
        this._gpuInfo = {
            // Device limits
            maxBufferSize: limits.maxBufferSize || 256 * 1024 * 1024,
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize || 128 * 1024 * 1024,
            maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize || 64 * 1024,
            maxTextureDimension2D: limits.maxTextureDimension2D || 8192,
            maxTextureArrayLayers: limits.maxTextureArrayLayers || 256,
            maxBindGroups: limits.maxBindGroups || 4,
            maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage || 8,
            
            // Adapter info (if available)
            vendor: null,
            architecture: null,
            device: null,
            description: null,
            
            // Probed values (filled later)
            estimatedVRAM: null,
            probedMaxAllocation: null,
        };
        
        // Get adapter info - use sync .info property (modern) or async requestAdapterInfo (legacy)
        if (adapter?.info) {
            // Modern sync API: adapter.info
            const info = adapter.info;
            this._gpuInfo.vendor = info.vendor || '';
            this._gpuInfo.architecture = info.architecture || '';
            this._gpuInfo.device = info.device || '';
            this._gpuInfo.description = info.description || '';
        } else if (adapter?.requestAdapterInfo) {
            // Legacy async API
            adapter.requestAdapterInfo().then(info => {
                this._gpuInfo.vendor = info.vendor || '';
                this._gpuInfo.architecture = info.architecture || '';
                this._gpuInfo.device = info.device || '';
                this._gpuInfo.description = info.description || '';
            }).catch(() => {});
        }
        
        // Also try device.adapterInfo if available
        const device = this.vgpu.device;
        if (device?.adapterInfo) {
            const info = device.adapterInfo;
            this._gpuInfo.vendor = info.vendor || this._gpuInfo.vendor || '';
            this._gpuInfo.architecture = info.architecture || this._gpuInfo.architecture || '';
            this._gpuInfo.device = info.device || this._gpuInfo.device || '';
            this._gpuInfo.description = info.description || this._gpuInfo.description || '';
        }
        
        // Update budgets based on device limits
        this.budgets.buffer = Math.min(this.budgets.buffer, this._gpuInfo.maxBufferSize);
    }
    
    /**
     * Get GPU info (limits and probed values)
     */
    getGPUInfo() {
        return this._gpuInfo ? { ...this._gpuInfo } : null;
    }
    
    /**
     * Probe GPU VRAM by allocating progressively larger buffers
     * Uses binary search to find maximum allocatable size
     * @param {Object} options
     * @param {number} [options.maxProbeSize] - Maximum size to try (default: 8GB)
     * @param {number} [options.stepSize] - Step size for linear probe (default: 64MB)
     * @param {boolean} [options.aggressive] - Try to fill VRAM to estimate total (slower)
     * @returns {Promise<{maxAllocation: number, estimatedVRAM: number}>}
     */
    async probeVRAM(options = {}) {
        if (this._destroyed) {
            return { maxAllocation: 0, estimatedVRAM: 0, cancelled: true };
        }
        if (this._probing) {
            return { maxAllocation: this._probedVRAM?.maxAllocation || 0, estimatedVRAM: this._probedVRAM?.estimatedVRAM || 0 };
        }
        
        this._probing = true;
        const probeGeneration = this._probeGeneration;
        const device = this.device;
        const testBuffers = [];
        let pendingBuffer = null;
        const cancellationError = () => {
            const error = new Error('VRAM probe was cancelled by GPU owner teardown');
            error.code = 'VGPU_MEMORY_PROBE_CANCELLED';
            return error;
        };
        const assertCurrent = () => {
            if (!this._destroyed && probeGeneration === this._probeGeneration) return;
            throw cancellationError();
        };
        const trackProbeBuffer = buffer => {
            if (buffer) this._probeBuffers.add(buffer);
            return buffer;
        };
        const releaseProbeBuffer = buffer => {
            if (!buffer || !this._probeBuffers.delete(buffer)) return;
            try { buffer.destroy?.(); } catch (_) {}
        };
        
        const maxProbeSize = options.maxProbeSize || 32 * 1024 * 1024 * 1024; // 32GB
        const stepSize = options.stepSize || 64 * 1024 * 1024; // 64MB
        const aggressive = options.aggressive || false;
        
        // Get actual device limit for max buffer size
        const deviceMaxBuffer = this.vgpu?.limits?.maxBufferSize || this._gpuInfo?.maxBufferSize || 256 * 1024 * 1024;
        console.log(`[VGPUMemoryTracker] Starting VRAM probe... (maxBufferSize: ${this._formatBytes(deviceMaxBuffer)})`);
        
        try {
            assertCurrent();
            // Phase 1: Binary search to find max single allocation (capped by device limit)
            let low = stepSize;
            let high = Math.min(maxProbeSize, deviceMaxBuffer);
            let maxAllocation = 0;
            
            let iteration = 0;
            while (low <= high) {
                assertCurrent();
                const mid = Math.floor((low + high) / 2);
                const alignedSize = Math.floor(mid / 4) * 4; // 4-byte alignment
                let testBuffer = null;
                try {
                    testBuffer = trackProbeBuffer(device.createBuffer({
                        size: alignedSize,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                        label: 'vram_probe_test',
                    }));
                    maxAllocation = alignedSize;
                    low = mid + stepSize;
                } catch (e) {
                    if (e?.code === 'VGPU_MEMORY_PROBE_CANCELLED') throw e;
                    high = mid - stepSize;
                } finally {
                    releaseProbeBuffer(testBuffer);
                }
                
                // Yield to browser every few iterations to prevent blocking UI
                if (++iteration % 3 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    assertCurrent();
                }
            }
            
            console.log(`[VGPUMemoryTracker] Max single allocation: ${this._formatBytes(maxAllocation)}`);
            
            // Phase 2: Estimate total VRAM by filling with buffers (if aggressive)
            let estimatedVRAM = maxAllocation;
            
            if (aggressive) {
                const chunkSize = 128 * 1024 * 1024; // 128MB chunks
                let totalAllocated = 0;
                let consecutiveOOM = 0;
                
                // Use error scopes to detect OOM without D3D12 console spam
                const maxFill = 32 * 1024 * 1024 * 1024; // 32GB absolute cap
                while (totalAllocated < maxFill) {
                    assertCurrent();
                    device.pushErrorScope('out-of-memory');
                    try {
                        pendingBuffer = trackProbeBuffer(device.createBuffer({
                            size: chunkSize,
                            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                            label: `vram_fill_${testBuffers.length}`,
                        }));
                    } catch (e) {
                        await device.popErrorScope();
                        assertCurrent();
                        break;
                    }
                    const oomError = await device.popErrorScope();
                    assertCurrent();
                    if (oomError) {
                        // GPU reported OOM — stop filling
                        releaseProbeBuffer(pendingBuffer);
                        pendingBuffer = null;
                        consecutiveOOM++;
                        if (consecutiveOOM >= 2) break; // Confirm OOM with 2 consecutive failures
                        continue;
                    }
                    consecutiveOOM = 0;
                    testBuffers.push(pendingBuffer);
                    pendingBuffer = null;
                    totalAllocated += chunkSize;
                    
                    // Yield to browser every 4 allocations
                    if (testBuffers.length % 4 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                        assertCurrent();
                    }
                }
                
                estimatedVRAM = totalAllocated;
                console.log(`[VGPUMemoryTracker] Total VRAM filled: ${this._formatBytes(totalAllocated)} (${testBuffers.length} buffers)`);
            }

            assertCurrent();
            // NOTE: WebGPU can allocate beyond physical VRAM using shared system memory
            // NVIDIA drivers (v546+) use "Shared GPU Memory" as overflow
            // So this value = dedicated VRAM + shared system RAM
            this._probedVRAM = { 
                maxAllocation, 
                estimatedVRAM,  // Total GPU-allocatable (VRAM + shared)
                note: 'Includes shared system memory (Resizable BAR/unified memory)',
            };
            
            // Update GPU info
            if (this._gpuInfo) {
                this._gpuInfo.probedMaxAllocation = maxAllocation;
                this._gpuInfo.estimatedVRAM = estimatedVRAM;
            }
            
            // Update budget to match probed capacity
            this.budgets.total = Math.floor(estimatedVRAM * 0.8); // Use 80% as safe budget
            
            console.log(`[VGPUMemoryTracker] VRAM probe complete. GPU Allocatable: ${this._formatBytes(estimatedVRAM)}`);
            console.log(`[VGPUMemoryTracker] NOTE: This includes shared system memory (VRAM + system RAM overflow)`);
            
            return { maxAllocation, estimatedVRAM };
            
        } catch (error) {
            if (error?.code === 'VGPU_MEMORY_PROBE_CANCELLED') {
                return { maxAllocation: 0, estimatedVRAM: 0, cancelled: true };
            }
            console.error('[VGPUMemoryTracker] VRAM probe failed:', error);
            return { maxAllocation: 0, estimatedVRAM: 0 };
        } finally {
            releaseProbeBuffer(pendingBuffer);
            for (const buffer of testBuffers) releaseProbeBuffer(buffer);
            testBuffers.length = 0;
            this._probing = false;
        }
    }
    
    /**
     * Quick probe - just get max single allocation (fast)
     */
    async quickProbe() {
        return this.probeVRAM({ aggressive: false });
    }
    
    /**
     * Full probe - estimate total VRAM (slower, fills memory)
     */
    async fullProbe() {
        return this.probeVRAM({ aggressive: true });
    }
    
    /**
     * Get probed VRAM info (null if not probed yet)
     */
    getProbedVRAM() {
        return this._probedVRAM ? { ...this._probedVRAM } : null;
    }
    
    /**
     * Check if VRAM has been probed
     */
    isProbed() {
        return this._probedVRAM !== null;
    }
    
    // ========================================================================
    // SYSTEM MEMORY DETECTION (RAM + JS Heap)
    // ========================================================================
    
    /**
     * Get system RAM info
     * Uses navigator.deviceMemory (approximate) and performance.memory (Chrome only)
     * @returns {{ deviceMemory: number, jsHeap: object, estimated: boolean }}
     */
    getSystemMemory() {
        const result = {
            // System RAM (approximate, in GB)
            deviceMemoryGB: navigator.deviceMemory || null,
            deviceMemoryBytes: navigator.deviceMemory ? navigator.deviceMemory * 1024 * 1024 * 1024 : null,
            
            // Probed RAM (filled after probeRAM()) - this is JS allocatable, not total system RAM
            probedRAM: this._probedRAM?.allocatedRAM || null,
            probedRAMFormatted: this._probedRAM?.allocatedRAM ? this._formatBytes(this._probedRAM.allocatedRAM) : null,
            
            // JS Heap (Chrome only via performance.memory)
            jsHeapUsed: null,
            jsHeapTotal: null,
            jsHeapLimit: null,
            jsHeapPercent: null,
            
            // Flags
            hasDeviceMemory: !!navigator.deviceMemory,
            hasJSHeap: false,
            hasProbedRAM: !!this._probedRAM,
            hasMeasureMemory: typeof performance.measureUserAgentSpecificMemory === 'function' && (typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false),
        };
        
        // Chrome's performance.memory API (non-standard but useful)
        if (performance.memory) {
            result.jsHeapUsed = performance.memory.usedJSHeapSize;
            result.jsHeapTotal = performance.memory.totalJSHeapSize;
            result.jsHeapLimit = performance.memory.jsHeapSizeLimit;
            result.jsHeapPercent = (result.jsHeapUsed / result.jsHeapLimit) * 100;
            result.hasJSHeap = true;
        }
        
        return result;
    }
    
    /**
     * Probe system RAM by allocating ArrayBuffers until allocation fails
     * This gives a more accurate picture of available RAM than navigator.deviceMemory
     * @param {Object} options
     * @param {number} [options.chunkSize] - Size of each allocation chunk (default: 64MB)
     * @param {number} [options.maxProbe] - Maximum RAM to try allocating (default: 64GB)
     * @param {number} [options.safetyMargin] - Leave this much RAM free (default: 512MB)
     * @returns {Promise<{allocatedRAM: number, estimatedRAM: number, chunks: number}>}
     */
    async probeRAM(options = {}) {
        if (this._destroyed) {
            return { allocatedRAM: 0, estimatedRAM: 0, chunks: 0, cancelled: true };
        }
        if (this._probingRAM) {
            return this._probedRAM || { allocatedRAM: 0, estimatedRAM: 0, chunks: 0 };
        }
        
        this._probingRAM = true;
        const probeGeneration = this._probeGeneration;
        const cancellationError = () => {
            const error = new Error('RAM probe was cancelled by GPU owner teardown');
            error.code = 'VGPU_MEMORY_PROBE_CANCELLED';
            return error;
        };
        const assertCurrent = () => {
            if (!this._destroyed && probeGeneration === this._probeGeneration) return;
            throw cancellationError();
        };
        
        const chunkSize = options.chunkSize || 64 * 1024 * 1024; // 64MB chunks
        const maxProbe = options.maxProbe || 64 * 1024 * 1024 * 1024; // 64GB max
        const safetyMargin = options.safetyMargin || 512 * 1024 * 1024; // Keep 512MB free
        const yieldEveryAllocations = Math.max(1, Math.floor(options.yieldEveryAllocations || 32));
        
        console.log(`[VGPUMemoryTracker] Starting RAM probe... (chunk size: ${this._formatBytes(chunkSize)})`);
        
        const chunks = [];
        this._ramProbeCollections.add(chunks);
        let totalAllocated = 0;
        let failed = false;
        
        try {
            assertCurrent();
            while (!failed && totalAllocated < maxProbe) {
                assertCurrent();
                try {
                    // Allocate a chunk of blank data (zeros)
                    const buffer = new ArrayBuffer(chunkSize);
                    // Touch the memory to ensure it's actually allocated (not just reserved)
                    const view = new Uint8Array(buffer);
                    view[0] = 0; // Touch first byte
                    view[chunkSize - 1] = 0; // Touch last byte
                    
                    chunks.push(buffer);
                    totalAllocated += chunkSize;
                    
                    // Log progress every 1GB
                    if (chunks.length % 16 === 0) {
                        console.log(`[VGPUMemoryTracker] RAM probe: ${this._formatBytes(totalAllocated)} allocated (${chunks.length} chunks)`);
                    }
                    
                    // Small delay to prevent UI freeze
                    if (chunks.length % yieldEveryAllocations === 0) {
                        await new Promise(r => setTimeout(r, 0));
                        assertCurrent();
                    }
                } catch (e) {
                    if (e?.code === 'VGPU_MEMORY_PROBE_CANCELLED') throw e;
                    // Allocation failed - we've hit the limit
                    failed = true;
                    console.log(`[VGPUMemoryTracker] RAM allocation stopped: ${e.message || 'out of memory'}`);
                }
            }
            assertCurrent();
            const allocatedRAM = totalAllocated;
            const numChunks = chunks.length;
            const reportedRAM = navigator.deviceMemory ? navigator.deviceMemory * 1024 * 1024 * 1024 : null;

            console.log(`[VGPUMemoryTracker] RAM probe: Allocated ${this._formatBytes(allocatedRAM)} in ${numChunks} chunks`);
            console.log('[VGPUMemoryTracker] NOTE: This is JS allocatable memory, not total system RAM');
            if (reportedRAM) {
                console.log(`[VGPUMemoryTracker] System reports ~${navigator.deviceMemory}GB RAM (navigator.deviceMemory)`);
            }

            this._probedRAM = {
                allocatedRAM,
                jsAllocatable: allocatedRAM,
                reportedRAM,
                chunks: numChunks,
                timestamp: Date.now(),
                note: 'JS allocatable memory (browser tab limit), not total system RAM',
            };
            console.log(`[VGPUMemoryTracker] RAM probe complete. JS Allocatable: ${this._formatBytes(allocatedRAM)}`);
            return this._probedRAM;
        } catch (error) {
            if (error?.code === 'VGPU_MEMORY_PROBE_CANCELLED') {
                return { allocatedRAM: 0, estimatedRAM: 0, chunks: 0, cancelled: true };
            }
            console.error('[VGPUMemoryTracker] RAM probe error:', error);
            return { allocatedRAM: 0, estimatedRAM: 0, chunks: 0 };
        } finally {
            chunks.length = 0;
            this._ramProbeCollections.delete(chunks);
            this._probingRAM = false;
            if (typeof gc === 'function') gc();
        }
    }
    
    /**
     * Get probed RAM info (null if not probed yet)
     */
    getProbedRAM() {
        return this._probedRAM ? { ...this._probedRAM } : null;
    }
    
    /**
     * Check if RAM has been probed
     */
    isRAMProbed() {
        return this._probedRAM !== null;
    }
    
    /**
     * Get detailed JS memory breakdown (requires cross-origin isolation)
     * Includes memory from workers and iframes
     * @returns {Promise<object|null>}
     */
    async measureJSMemory() {
        if (typeof performance.measureUserAgentSpecificMemory !== 'function') {
            return null;
        }
        if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
            return null;
        }
        
        try {
            const result = await performance.measureUserAgentSpecificMemory();
            
            // Parse breakdown to get memory by source
            const bySource = {};
            for (const item of result.breakdown || []) {
                for (const attr of item.attribution || []) {
                    const url = attr.url || 'unknown';
                    bySource[url] = (bySource[url] || 0) + item.bytes;
                }
            }
            
            return {
                bytes: result.bytes,
                formatted: this._formatBytes(result.bytes),
                breakdown: result.breakdown,
                bySource,
            };
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Get comprehensive memory capabilities info
     */
    getMemoryCapabilities() {
        const features = this.vgpu.features || new Set();
        
        return {
            // Cross-origin isolation (needed for SharedArrayBuffer, measureUserAgentSpecificMemory)
            crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
            
            // Available APIs
            hasPerformanceMemory: !!performance.memory,
            hasMeasureMemory: typeof performance.measureUserAgentSpecificMemory === 'function',
            hasDeviceMemory: 'deviceMemory' in navigator,
            hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            hasStorageEstimate: !!(navigator.storage?.estimate),
            
            // WebGPU capabilities
            hasWebGPU: !!navigator.gpu,
            hasTimestampQuery: features.has?.('timestamp-query') || false,
            hasShaderF16: features.has?.('shader-f16') || false,
            hasSubgroups: features.has?.('subgroups') || false,
            hasIndirectFirstInstance: features.has?.('indirect-first-instance') || false,
            hasBCCompression: features.has?.('texture-compression-bc') || false,
            hasFloat32Filterable: features.has?.('float32-filterable') || false,
            hasDepthClipControl: features.has?.('depth-clip-control') || false,
            hasDualSourceBlending: features.has?.('dual-source-blending') || false,
            
            // Browser capabilities
            hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
            hasWebWorkers: typeof Worker !== 'undefined',
            hasWASM: typeof WebAssembly !== 'undefined',
            hasWASMThreads: this._detectWASMThreads(),
            hasWASMSIMD: this._detectWASMSIMD(),
            hasRequestIdleCallback: 'requestIdleCallback' in window,
            hasFinalizationRegistry: typeof FinalizationRegistry !== 'undefined',
            hasWeakRef: typeof WeakRef !== 'undefined',
            
            // Limits from device
            jsHeapLimit: performance.memory?.jsHeapSizeLimit || null,
            jsHeapLimitFormatted: performance.memory?.jsHeapSizeLimit 
                ? this._formatBytes(performance.memory.jsHeapSizeLimit) : 'Unknown',
            maxBufferSize: this._gpuInfo?.maxBufferSize || null,
            maxBufferSizeFormatted: this._gpuInfo?.maxBufferSize 
                ? this._formatBytes(this._gpuInfo.maxBufferSize) : 'Unknown',
        };
    }
    
    /**
     * Detect WASM SIMD support (v128 type)
     */
    _detectWASMSIMD() {
        return detectWasmSimd();
    }
    
    /**
     * Detect WASM Threads support
     */
    _detectWASMThreads() {
        return detectWasmThreads();
    }
    
    /**
     * Get all capabilities as a compact object
     */
    getAllCapabilities() {
        const f = this.vgpu.features || new Set();
        const has = (name) => f.has?.(name) || false;
        
        return {
            // Browser
            coi: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
            sab: typeof SharedArrayBuffer !== 'undefined',
            offscreen: typeof OffscreenCanvas !== 'undefined',
            workers: typeof Worker !== 'undefined',
            idle: 'requestIdleCallback' in window,
            
            // WASM
            wasm: typeof WebAssembly !== 'undefined',
            simd: this._detectWASMSIMD(),
            threads: this._detectWASMThreads(),
            
            // WebGPU Features
            timestamp: has('timestamp-query'),
            f16: has('shader-f16'),
            subgroups: has('subgroups'),
            indirect: has('indirect-first-instance'),
            bc: has('texture-compression-bc'),
            astc: has('texture-compression-astc'),
            etc2: has('texture-compression-etc2'),
            f32filter: has('float32-filterable'),
            f32blend: has('float32-blendable'),
            depthClip: has('depth-clip-control'),
            dualBlend: has('dual-source-blending'),
            bgra: has('bgra8unorm-storage'),
        };
    }
    
    /**
     * Get storage quota and usage (IndexedDB, Cache API, etc.)
     * This can give hints about available disk/memory
     * @returns {Promise<object|null>}
     */
    async getStorageEstimate() {
        if (!navigator.storage?.estimate) return null;
        
        try {
            const estimate = await navigator.storage.estimate();
            return {
                quota: estimate.quota,
                quotaFormatted: this._formatBytes(estimate.quota),
                usage: estimate.usage,
                usageFormatted: this._formatBytes(estimate.usage),
                percentUsed: estimate.quota ? ((estimate.usage / estimate.quota) * 100).toFixed(1) : 0,
                // Breakdown by storage type (if available)
                usageDetails: estimate.usageDetails || null,
            };
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Get WebGL memory info (if WebGL context available)
     * Uses WEBGL_debug_renderer_info extension
     * @param {WebGLRenderingContext} gl - Optional WebGL context
     * @returns {object|null}
     */
    getWebGLInfo(gl) {
        if (!gl) {
            // Try to create a temporary context
            try {
                const canvas = document.createElement('canvas');
                gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            } catch (e) {
                return null;
            }
        }
        if (!gl) return null;
        
        const result = {
            vendor: null,
            renderer: null,
            unmaskedVendor: null,
            unmaskedRenderer: null,
        };
        
        result.vendor = gl.getParameter(gl.VENDOR);
        result.renderer = gl.getParameter(gl.RENDERER);
        
        // Try to get unmasked info
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
            result.unmaskedVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
            result.unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
        
        return result;
    }
    
    /**
     * Get memory pressure state (experimental)
     * Some browsers support this via navigator.deviceMemory or onmemorypressure
     */
    getMemoryPressure() {
        // Check for experimental memory pressure API
        const hasMemoryPressure = 'onmemorypressure' in window || 'memory' in navigator;
        
        // Estimate pressure based on JS heap usage
        let estimatedPressure = 'normal';
        if (performance.memory) {
            const usedRatio = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
            if (usedRatio > 0.9) estimatedPressure = 'critical';
            else if (usedRatio > 0.7) estimatedPressure = 'high';
            else if (usedRatio > 0.5) estimatedPressure = 'moderate';
        }
        
        return {
            hasAPI: hasMemoryPressure,
            estimated: estimatedPressure,
            jsHeapRatio: performance.memory 
                ? (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) 
                : null,
        };
    }
    
    /**
     * Monitor memory changes over time
     * Returns a function to stop monitoring
     * @param {function} callback - Called with memory stats
     * @param {number} intervalMs - Polling interval (default 1000ms)
     */
    monitorMemory(callback, intervalMs = 1000) {
        if (this._destroyed) {
            throw new Error('[VGPUMemoryTracker] Tracker is destroyed');
        }
        let lastStats = null;
        
        const checkMemory = () => {
            const current = {
                timestamp: Date.now(),
                jsHeap: performance.memory ? {
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                } : null,
                vram: this.getUsage(),
            };
            
            // Calculate deltas
            if (lastStats) {
                current.delta = {
                    jsHeapUsed: current.jsHeap 
                        ? current.jsHeap.used - lastStats.jsHeap.used 
                        : 0,
                    vramTotal: current.vram.total - lastStats.vram.total,
                    timeMs: current.timestamp - lastStats.timestamp,
                };
            }
            
            lastStats = current;
            callback(current);
        };
        
        const intervalId = setInterval(checkMemory, intervalMs);
        this._monitorIntervals.add(intervalId);
        checkMemory(); // Initial call
        
        // Return stop function
        return () => {
            clearInterval(intervalId);
            this._monitorIntervals.delete(intervalId);
        };
    }
    
    // ========================================================================
    // LEAK DETECTION (FinalizationRegistry)
    // ========================================================================
    
    /**
     * Start tracking an object for leak detection
     * When the object is garbage collected, we'll know
     * @param {object} obj - Object to track
     * @param {string} label - Label for identification
     */
    trackForLeaks(obj, label) {
        if (!this._leakRegistry) {
            this._leakRegistry = new FinalizationRegistry((heldValue) => {
                this._leakLog.push({
                    label: heldValue,
                    gcTime: Date.now(),
                });
                console.log(`[VGPUMemoryTracker] Object GC'd: ${heldValue}`);
            });
            this._leakLog = [];
            this._trackedObjects = new Map();
        }
        
        // Use WeakRef to track without preventing GC
        const ref = new WeakRef(obj);
        this._trackedObjects.set(label, { ref, createTime: Date.now() });
        this._leakRegistry.register(obj, label);
    }
    
    /**
     * Check which tracked objects are still alive (potential leaks)
     */
    checkLeaks() {
        if (!this._trackedObjects) return { alive: [], collected: [] };
        
        const alive = [];
        const collected = [];
        
        for (const [label, entry] of this._trackedObjects) {
            const obj = entry.ref.deref();
            if (obj) {
                alive.push({ label, ageMs: Date.now() - entry.createTime });
            } else {
                collected.push(label);
            }
        }
        
        return { alive, collected, gcLog: this._leakLog || [] };
    }
    
    // ========================================================================
    // NON-BLOCKING MEASUREMENTS (requestIdleCallback)
    // ========================================================================
    
    /**
     * Schedule memory measurement during browser idle time
     * @param {function} callback - Called with memory stats
     * @param {object} options - requestIdleCallback options
     */
    measureWhenIdle(callback, options = { timeout: 2000 }) {
        if (this._destroyed) {
            throw new Error('[VGPUMemoryTracker] Tracker is destroyed');
        }
        let handle = null;
        const measure = (deadline) => {
            this._idleMeasurements.delete(handle);
            // Only do work if we have time
            if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
                const stats = {
                    jsHeap: performance.memory ? {
                        used: performance.memory.usedJSHeapSize,
                        total: performance.memory.totalJSHeapSize,
                        limit: performance.memory.jsHeapSizeLimit,
                    } : null,
                    vram: this.getUsage(),
                    pressure: this.getMemoryPressure(),
                    idleTimeRemaining: deadline.timeRemaining(),
                    didTimeout: deadline.didTimeout,
                };
                callback(stats);
            }
        };
        
        if (typeof globalThis.requestIdleCallback === 'function') {
            handle = globalThis.requestIdleCallback(measure, options);
        } else {
            // Fallback for browsers without requestIdleCallback
            handle = setTimeout(() => measure({ timeRemaining: () => 50, didTimeout: true }), 1);
        }
        this._idleMeasurements.add(handle);
        return handle;
    }
    
    /**
     * Cancel a pending idle measurement
     */
    cancelIdleMeasurement(handle) {
        if (handle === null || handle === undefined) return;
        if (typeof globalThis.cancelIdleCallback === 'function') {
            globalThis.cancelIdleCallback(handle);
        } else {
            clearTimeout(handle);
        }
        this._idleMeasurements.delete(handle);
    }
    
    // ========================================================================
    // GPU TIMING HELPER
    // ========================================================================
    
    /**
     * Create a GPU timing helper for timestamp queries
     * Requires 'timestamp-query' feature to be enabled on device
     */
    createTimingHelper() {
        if (this._destroyed) throw new Error('[VGPUMemoryTracker] Tracker is destroyed');
        const device = this.device;
        const canTimestamp = this.vgpu.features?.has?.('timestamp-query') || false;
        
        if (!canTimestamp) {
            console.warn('[VGPUMemoryTracker] timestamp-query not available');
            return null;
        }

        const generation = this._probeGeneration;
        const assertCandidateCurrent = () => {
            if (!this._destroyed && generation === this._probeGeneration) return;
            const error = new Error('[VGPUMemoryTracker] Tracker is destroyed');
            error.name = 'AbortError';
            error.code = 'VGPU_MEMORY_TRACKER_DESTROYED';
            throw error;
        };
        
        let querySet = null;
        let resolveBuffer = null;
        let resultBuffer = null;
        try {
            querySet = device.createQuerySet({
                type: 'timestamp',
                count: 2,
            });
            assertCandidateCurrent();
            resolveBuffer = device.createBuffer({
                size: querySet.count * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            assertCandidateCurrent();
            resultBuffer = device.createBuffer({
                size: resolveBuffer.size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            assertCandidateCurrent();
        } catch (error) {
            try { resultBuffer?.destroy?.(); } catch (_) {}
            try { resolveBuffer?.destroy?.(); } catch (_) {}
            try { querySet?.destroy?.(); } catch (_) {}
            throw error;
        }
        
        const tracker = this;
        const helper = {
            querySet,
            resolveBuffer,
            resultBuffer,
            _destroyed: false,
            _generation: 0,
            _destroyError: null,
            _activeRead: null,
            
            /**
             * Get timestampWrites config for render/compute pass
             */
            getTimestampWrites() {
                if (helper._destroyed) throw helper._destroyError;
                return {
                    querySet: helper.querySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                };
            },
            
            /**
             * Resolve timing after pass ends
             * @param {GPUCommandEncoder} encoder
             */
            resolve(encoder) {
                if (helper._destroyed) throw helper._destroyError;
                encoder.resolveQuerySet(helper.querySet, 0, helper.querySet.count, helper.resolveBuffer, 0);
                encoder.copyBufferToBuffer(helper.resolveBuffer, 0, helper.resultBuffer, 0, helper.resultBuffer.size);
            },
            
            /**
             * Read the timing result (call after queue.submit)
             * @returns {Promise<number>} Duration in nanoseconds
             */
            getResult() {
                if (helper._destroyed) return Promise.reject(helper._destroyError);
                if (helper._activeRead) return helper._activeRead.promise;

                let resolvePublic;
                let rejectPublic;
                let cancelWait;
                const operation = {
                    generation: helper._generation,
                    resultBuffer: helper.resultBuffer,
                    mapped: false,
                    settled: false,
                    cancelled: false,
                    promise: null,
                    cancellation: null,
                };
                operation.promise = new Promise((resolve, reject) => {
                    resolvePublic = resolve;
                    rejectPublic = reject;
                });
                operation.resolve = resolvePublic;
                operation.reject = rejectPublic;
                operation.cancellation = new Promise(resolve => { cancelWait = resolve; });
                operation.cancelWait = cancelWait;
                helper._activeRead = operation;

                const rawOutcome = Promise.resolve()
                    .then(() => {
                        if (!helper._isReadCurrent(operation)) throw helper._destroyError;
                        return operation.resultBuffer.mapAsync(GPUMapMode.READ);
                    })
                    .then(
                        () => ({ status: 'mapped' }),
                        error => ({ status: 'rejected', error }),
                    );
                void Promise.race([
                    rawOutcome,
                    operation.cancellation.then(error => ({ status: 'cancelled', error })),
                ]).then(outcome => {
                    if (outcome.status === 'cancelled' || !helper._isReadCurrent(operation)) return;
                    if (outcome.status === 'rejected') {
                        helper._settleRead(operation, null, outcome.error);
                        return;
                    }

                    operation.mapped = true;
                    try {
                        const times = new BigInt64Array(operation.resultBuffer.getMappedRange());
                        if (!helper._isReadCurrent(operation)) return;
                        const duration = Number(times[1] - times[0]);
                        operation.resultBuffer.unmap();
                        operation.mapped = false;
                        helper._settleRead(operation, duration, null);
                    } catch (error) {
                        if (operation.mapped) {
                            try { operation.resultBuffer?.unmap?.(); } catch (_) {}
                            operation.mapped = false;
                        }
                        helper._settleRead(operation, null, error);
                    }
                });
                return operation.promise;
            },

            _isReadCurrent(operation) {
                return Boolean(operation)
                    && !operation.settled
                    && !operation.cancelled
                    && !helper._destroyed
                    && operation.generation === helper._generation
                    && helper._activeRead === operation
                    && helper.resultBuffer === operation.resultBuffer;
            },

            _settleRead(operation, value, error) {
                if (!operation || operation.settled) return false;
                operation.settled = true;
                if (helper._activeRead === operation) helper._activeRead = null;
                if (error) operation.reject(error);
                else operation.resolve(value);
                return true;
            },
            
            /**
             * Destroy timing resources
             */
            destroy() {
                if (helper._destroyed) return false;
                helper._destroyed = true;
                helper._generation++;
                const error = new Error('[VGPUMemoryTracker] Timing helper destroyed');
                error.name = 'AbortError';
                error.code = 'VGPU_TIMING_HELPER_DESTROYED';
                helper._destroyError = error;
                const operation = helper._activeRead;
                helper._activeRead = null;
                if (operation) {
                    operation.cancelled = true;
                    if (operation.mapped) {
                        try { operation.resultBuffer?.unmap?.(); } catch (_) {}
                        operation.mapped = false;
                    }
                }

                const ownedQuerySet = helper.querySet;
                const ownedResolveBuffer = helper.resolveBuffer;
                const ownedResultBuffer = helper.resultBuffer;
                helper.querySet = null;
                helper.resolveBuffer = null;
                helper.resultBuffer = null;
                try { ownedQuerySet?.destroy?.(); } catch (_) {}
                try { ownedResolveBuffer?.destroy?.(); } catch (_) {}
                try { ownedResultBuffer?.destroy?.(); } catch (_) {}

                if (operation) {
                    operation.resultBuffer = null;
                    operation.cancelWait(error);
                    helper._settleRead(operation, null, error);
                }
                tracker._timingHelpers.delete(helper);
                return true;
            },
        };
        assertCandidateCurrent();
        this._timingHelpers.add(helper);
        return helper;
    }
    
    /**
     * Get comprehensive memory snapshot for debugging
     */
    async getMemorySnapshot() {
        const snapshot = {
            timestamp: Date.now(),
            
            // JS Heap
            jsHeap: performance.memory ? {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit,
            } : null,
            
            // VRAM usage
            vram: this.getUsage(),
            vramProbed: this.getProbedVRAM(),
            
            // RAM
            ramReported: navigator.deviceMemory ? navigator.deviceMemory * 1024 * 1024 * 1024 : null,
            ramProbed: this.getProbedRAM(),
            
            // Storage
            storage: await this.getStorageEstimate(),
            
            // GPU Info
            gpu: this.getGPUInfo(),
            
            // Pressure
            pressure: this.getMemoryPressure(),
            
            // Capabilities
            capabilities: this.getMemoryCapabilities(),
        };
        
        return snapshot;
    }
    
    /**
     * Get full system info for profiler display
     */
    getFullSystemInfo() {
        const gpuInfo = this.getGPUInfo() || {};
        const sysMem = this.getSystemMemory();
        const caps = this.getMemoryCapabilities();
        const vramProbed = this.getProbedVRAM();
        const ramProbed = this.getProbedRAM();
        
        return {
            gpu: {
                vendor: gpuInfo.vendor || '--',
                device: gpuInfo.device || '--', 
                architecture: gpuInfo.architecture || '--',
                description: gpuInfo.description || '',
                maxBufferSize: gpuInfo.maxBufferSize,
                maxBufferSizeFormatted: this._formatBytes(gpuInfo.maxBufferSize || 0),
                maxStorageBufferBindingSize: gpuInfo.maxStorageBufferBindingSize,
                maxStorageFormatted: this._formatBytes(gpuInfo.maxStorageBufferBindingSize || 0),
            },
            vram: {
                used: this._usage.total,
                usedFormatted: this._formatBytes(this._usage.total),
                allocatable: vramProbed?.estimatedVRAM || null,
                allocatableFormatted: vramProbed?.estimatedVRAM 
                    ? this._formatBytes(vramProbed.estimatedVRAM) : 'Not probed',
                note: 'Includes VRAM + shared system RAM (Resizable BAR)',
            },
            ram: {
                reported: sysMem.deviceMemoryGB ? `${sysMem.deviceMemoryGB} GB` : 'Unknown',
                reportedBytes: sysMem.deviceMemoryBytes,
                jsAllocatable: ramProbed?.allocatedRAM || null,
                jsAllocatableFormatted: ramProbed?.allocatedRAM 
                    ? this._formatBytes(ramProbed.allocatedRAM) : 'Not probed',
                note: 'JS limited by browser tab (~4GB heap limit)',
            },
            jsHeap: {
                used: sysMem.jsHeapUsed,
                usedFormatted: sysMem.jsHeapUsed ? this._formatBytes(sysMem.jsHeapUsed) : 'N/A',
                total: sysMem.jsHeapTotal,
                totalFormatted: sysMem.jsHeapTotal ? this._formatBytes(sysMem.jsHeapTotal) : 'N/A',
                limit: sysMem.jsHeapLimit,
                limitFormatted: sysMem.jsHeapLimit ? this._formatBytes(sysMem.jsHeapLimit) : 'N/A',
                percent: sysMem.jsHeapPercent,
            },
            capabilities: caps,
        };
    }
    
    /**
     * Estimate VRAM usage from buffer manager (for buffers not tracked individually)
     */
    getEstimatedVRAMUsage() {
        let total = this._usage.total;
        
        // Also count buffers from vgpu.buffer.managed if available
        const bufferManager = this.vgpu.buffer;
        if (bufferManager?.managed) {
            let managedTotal = 0;
            for (const entry of bufferManager.managed.values()) {
                managedTotal += entry.size || 0;
            }
            // Use the larger of tracked or managed (in case some overlap)
            total = Math.max(total, managedTotal);
        }
        
        return {
            tracked: this._usage.total,
            managed: total,
            formatted: this._formatBytes(total),
        };
    }
    
    /**
     * Get formatted system memory info
     */
    getSystemMemoryFormatted() {
        const mem = this.getSystemMemory();
        return {
            ram: mem.deviceMemoryGB ? `${mem.deviceMemoryGB} GB` : 'Unknown',
            jsUsed: mem.jsHeapUsed ? this._formatBytes(mem.jsHeapUsed) : 'N/A',
            jsTotal: mem.jsHeapTotal ? this._formatBytes(mem.jsHeapTotal) : 'N/A',
            jsLimit: mem.jsHeapLimit ? this._formatBytes(mem.jsHeapLimit) : 'N/A',
            jsPercent: mem.jsHeapPercent ? `${mem.jsHeapPercent.toFixed(1)}%` : 'N/A',
        };
    }
    
    /**
     * Get comprehensive memory report (VRAM + RAM + JS)
     */
    getFullMemoryReport() {
        const vram = this.getUsage();
        const probed = this.getProbedVRAM();
        const sys = this.getSystemMemory();
        const gpuInfo = this.getGPUInfo();
        
        return {
            // VRAM (GPU)
            vram: {
                used: vram.total,
                usedFormatted: this._formatBytes(vram.total),
                buffers: vram.buffer,
                textures: vram.texture,
                bufferCount: vram.bufferCount,
                textureCount: vram.textureCount,
                estimated: probed?.estimatedVRAM || null,
                estimatedFormatted: probed?.estimatedVRAM ? this._formatBytes(probed.estimatedVRAM) : 'Not probed',
                percent: probed?.estimatedVRAM ? (vram.total / probed.estimatedVRAM) * 100 : null,
                maxBuffer: gpuInfo?.maxBufferSize || null,
            },
            
            // System RAM
            ram: {
                total: sys.deviceMemoryBytes,
                totalFormatted: sys.deviceMemoryGB ? `${sys.deviceMemoryGB} GB` : 'Unknown',
                available: sys.hasDeviceMemory,
            },
            
            // JavaScript Heap
            jsHeap: {
                used: sys.jsHeapUsed,
                usedFormatted: sys.jsHeapUsed ? this._formatBytes(sys.jsHeapUsed) : 'N/A',
                total: sys.jsHeapTotal,
                totalFormatted: sys.jsHeapTotal ? this._formatBytes(sys.jsHeapTotal) : 'N/A',
                limit: sys.jsHeapLimit,
                limitFormatted: sys.jsHeapLimit ? this._formatBytes(sys.jsHeapLimit) : 'N/A',
                percent: sys.jsHeapPercent,
                available: sys.hasJSHeap,
            },
        };
    }
}
