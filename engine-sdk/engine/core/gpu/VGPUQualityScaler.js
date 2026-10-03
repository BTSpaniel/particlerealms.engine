// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Quality Scaler - Dynamic resolution/quality based on frame time budget
 */

export class VGPUQualityScaler {
    constructor(vgpu, options = {}) {
        this.vgpu = vgpu;
        
        // Target frame time in ms
        this.targetFrameTime = options.targetFrameTime || 16.67;  // 60 FPS
        this.minFrameTime = options.minFrameTime || this.targetFrameTime * 0.8;
        this.maxFrameTime = options.maxFrameTime || this.targetFrameTime * 1.2;
        
        // Resolution scale limits
        this.minScale = options.minScale || 0.5;
        this.maxScale = options.maxScale || 1.0;
        this.scaleStep = options.scaleStep || 0.05;
        
        // Current state
        this._currentScale = options.initialScale || 1.0;
        this._targetScale = this._currentScale;
        
        // Smoothing
        this._frameTimeHistory = [];
        this._historySize = options.historySize || 30;
        this._smoothingFactor = options.smoothingFactor || 0.1;
        
        // Hysteresis to prevent oscillation
        this._increaseThreshold = options.increaseThreshold || 0.9;  // 90% of budget
        this._decreaseThreshold = options.decreaseThreshold || 1.1;  // 110% of budget
        this._stabilityFrames = options.stabilityFrames || 10;
        this._stableFrameCount = 0;
        
        // Quality levels for discrete scaling
        this._qualityLevels = options.qualityLevels || [
            { name: 'ultra', scale: 1.0, settings: {} },
            { name: 'high', scale: 0.85, settings: {} },
            { name: 'medium', scale: 0.7, settings: {} },
            { name: 'low', scale: 0.5, settings: {} },
        ];
        this._currentQualityIndex = 0;
        
        // Callbacks
        this._onScaleChange = options.onScaleChange || null;
        this._onQualityChange = options.onQualityChange || null;
        
        // Stats
        this._stats = {
            avgFrameTime: 0,
            scaleChanges: 0,
            qualityChanges: 0,
            timeInBudget: 0,
            totalFrames: 0,
        };
    }

    /**
     * Update with current frame time
     * @param {number} frameTimeMs - Frame time in milliseconds
     */
    update(frameTimeMs) {
        this._stats.totalFrames++;
        
        // Update history
        this._frameTimeHistory.push(frameTimeMs);
        if (this._frameTimeHistory.length > this._historySize) {
            this._frameTimeHistory.shift();
        }
        
        // Calculate smoothed frame time
        const avgFrameTime = this._getAverageFrameTime();
        this._stats.avgFrameTime = avgFrameTime;
        
        // Check if within budget
        if (avgFrameTime <= this.targetFrameTime) {
            this._stats.timeInBudget++;
        }
        
        // Determine scaling action
        const budgetRatio = avgFrameTime / this.targetFrameTime;
        
        if (budgetRatio > this._decreaseThreshold) {
            // Frame time too high, decrease quality
            this._stableFrameCount = 0;
            this._adjustScale(-this.scaleStep);
        } else if (budgetRatio < this._increaseThreshold) {
            // Frame time low, potentially increase quality
            this._stableFrameCount++;
            if (this._stableFrameCount >= this._stabilityFrames) {
                this._adjustScale(this.scaleStep);
                this._stableFrameCount = 0;
            }
        } else {
            // Within acceptable range
            this._stableFrameCount = 0;
        }
        
        // Smoothly interpolate to target
        this._currentScale += (this._targetScale - this._currentScale) * this._smoothingFactor;
    }

    /**
     * Get current resolution scale (0-1)
     */
    getScale() {
        return this._currentScale;
    }

    /**
     * Get render resolution for a base resolution
     */
    getRenderResolution(baseWidth, baseHeight) {
        return {
            width: Math.max(1, Math.floor(baseWidth * this._currentScale)),
            height: Math.max(1, Math.floor(baseHeight * this._currentScale)),
            scale: this._currentScale,
        };
    }

    /**
     * Force a specific scale
     */
    setScale(scale) {
        this._targetScale = Math.max(this.minScale, Math.min(this.maxScale, scale));
        this._currentScale = this._targetScale;
        this._stats.scaleChanges++;
        if (this._onScaleChange) {
            this._onScaleChange(this._currentScale);
        }
    }

    /**
     * Use discrete quality levels instead of continuous scaling
     */
    updateQualityLevel(frameTimeMs) {
        this._stats.totalFrames++;
        
        this._frameTimeHistory.push(frameTimeMs);
        if (this._frameTimeHistory.length > this._historySize) {
            this._frameTimeHistory.shift();
        }
        
        const avgFrameTime = this._getAverageFrameTime();
        this._stats.avgFrameTime = avgFrameTime;
        
        const budgetRatio = avgFrameTime / this.targetFrameTime;
        
        if (budgetRatio > this._decreaseThreshold && this._currentQualityIndex < this._qualityLevels.length - 1) {
            this._stableFrameCount = 0;
            this._setQualityLevel(this._currentQualityIndex + 1);
        } else if (budgetRatio < this._increaseThreshold && this._currentQualityIndex > 0) {
            this._stableFrameCount++;
            if (this._stableFrameCount >= this._stabilityFrames) {
                this._setQualityLevel(this._currentQualityIndex - 1);
                this._stableFrameCount = 0;
            }
        } else {
            this._stableFrameCount = 0;
        }
    }

    /**
     * Get current quality level
     */
    getQualityLevel() {
        return this._qualityLevels[this._currentQualityIndex];
    }

    /**
     * Set quality level by name
     */
    setQualityLevelByName(name) {
        const index = this._qualityLevels.findIndex(l => l.name === name);
        if (index >= 0) {
            this._setQualityLevel(index);
        }
    }

    /**
     * Get all quality level names
     */
    getQualityLevelNames() {
        return this._qualityLevels.map(l => l.name);
    }

    /**
     * Configure quality levels
     */
    setQualityLevels(levels) {
        this._qualityLevels = levels.sort((a, b) => b.scale - a.scale);
        this._currentQualityIndex = 0;
    }

    /**
     * Get performance stats
     */
    getStats() {
        return {
            ...this._stats,
            currentScale: this._currentScale,
            targetScale: this._targetScale,
            currentQuality: this._qualityLevels[this._currentQualityIndex]?.name,
            budgetUtilization: (this._stats.avgFrameTime / this.targetFrameTime * 100).toFixed(1) + '%',
            timeInBudgetPercent: (this._stats.timeInBudget / this._stats.totalFrames * 100).toFixed(1) + '%',
        };
    }

    /**
     * Reset stats
     */
    resetStats() {
        this._stats = {
            avgFrameTime: 0,
            scaleChanges: 0,
            qualityChanges: 0,
            timeInBudget: 0,
            totalFrames: 0,
        };
    }

    /**
     * Set target FPS
     */
    setTargetFPS(fps) {
        this.targetFrameTime = 1000 / fps;
        this.minFrameTime = this.targetFrameTime * 0.8;
        this.maxFrameTime = this.targetFrameTime * 1.2;
    }

    /**
     * Set callbacks
     */
    onScaleChange(callback) {
        this._onScaleChange = callback;
    }

    onQualityChange(callback) {
        this._onQualityChange = callback;
    }

    _adjustScale(delta) {
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this._targetScale + delta));
        if (newScale !== this._targetScale) {
            this._targetScale = newScale;
            this._stats.scaleChanges++;
            if (this._onScaleChange) {
                this._onScaleChange(this._targetScale);
            }
        }
    }

    _setQualityLevel(index) {
        if (index !== this._currentQualityIndex) {
            this._currentQualityIndex = index;
            const level = this._qualityLevels[index];
            this._targetScale = level.scale;
            this._stats.qualityChanges++;
            if (this._onQualityChange) {
                this._onQualityChange(level);
            }
        }
    }

    _getAverageFrameTime() {
        if (this._frameTimeHistory.length === 0) return this.targetFrameTime;
        
        // Use weighted average giving more weight to recent frames
        let sum = 0;
        let weightSum = 0;
        for (let i = 0; i < this._frameTimeHistory.length; i++) {
            const weight = (i + 1) / this._frameTimeHistory.length;
            sum += this._frameTimeHistory[i] * weight;
            weightSum += weight;
        }
        return sum / weightSum;
    }
}

/**
 * Viewport manager for dynamic resolution
 */
export class VGPUDynamicViewport {
    constructor(vgpu, baseWidth, baseHeight) {
        this.vgpu = vgpu;
        this.baseWidth = baseWidth;
        this.baseHeight = baseHeight;

        this._renderTexture = null;
        this._renderView = null;
        this._depthTexture = null;
        this._depthView = null;
        this._currentScale = 1.0;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        this._parentFactoryGeneration = Number.isSafeInteger(vgpu?._factoryGeneration)
            ? vgpu._factoryGeneration
            : null;
        this._textureOperations = new Set();
    }

    /**
     * Update render targets for new scale
     */
    updateScale(scale) {
        this._assertAlive();
        if (Math.abs(scale - this._currentScale) < 0.01) return;

        this._recreateTextures({ scale });
    }

    /**
     * Update base resolution
     */
    setBaseResolution(width, height) {
        this._assertAlive();
        this._recreateTextures({ baseWidth: width, baseHeight: height });
    }

    /**
     * Get current render texture
     */
    getRenderTexture() {
        this._assertAlive();
        if (!this._renderTexture) {
            this._recreateTextures();
        }
        return this._renderTexture;
    }

    /**
     * Get current render view
     */
    getRenderView() {
        this._assertAlive();
        if (!this._renderView) {
            this._recreateTextures();
        }
        return this._renderView;
    }

    /**
     * Get depth texture
     */
    getDepthTexture() {
        this._assertAlive();
        return this._depthTexture;
    }

    /**
     * Get depth view
     */
    getDepthView() {
        this._assertAlive();
        return this._depthView;
    }

    /**
     * Get current dimensions
     */
    getDimensions() {
        this._assertAlive();
        const width = Math.max(1, Math.floor(this.baseWidth * this._currentScale));
        const height = Math.max(1, Math.floor(this.baseHeight * this._currentScale));
        return { width, height, scale: this._currentScale };
    }

    _recreateTextures(next = {}) {
        this._assertAlive();
        const generation = this._generation;
        const baseWidth = next.baseWidth ?? this.baseWidth;
        const baseHeight = next.baseHeight ?? this.baseHeight;
        const scale = next.scale ?? this._currentScale;
        const width = Math.max(1, Math.floor(baseWidth * scale));
        const height = Math.max(1, Math.floor(baseHeight * scale));
        this._assertGeneration(generation);
        const operation = {
            generation,
            renderTexture: null,
            renderView: null,
            depthTexture: null,
            depthView: null,
            retired: false,
        };
        this._textureOperations.add(operation);

        try {
            const renderTexture = this.vgpu.device.createTexture({
                size: { width, height },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                label: 'DynamicViewport_Color',
            });
            if (operation.retired) {
                try { renderTexture.destroy?.(); } catch (_) {}
                this._assertGeneration(generation);
            }
            operation.renderTexture = renderTexture;
            this._assertGeneration(generation);
            const renderView = operation.renderTexture.createView();
            if (operation.retired) this._assertGeneration(generation);
            operation.renderView = renderView;
            this._assertGeneration(generation);

            const depthTexture = this.vgpu.device.createTexture({
                size: { width, height },
                format: 'depth24plus',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                label: 'DynamicViewport_Depth',
            });
            if (operation.retired) {
                try { depthTexture.destroy?.(); } catch (_) {}
                this._assertGeneration(generation);
            }
            operation.depthTexture = depthTexture;
            this._assertGeneration(generation);
            const depthView = operation.depthTexture.createView();
            if (operation.retired) this._assertGeneration(generation);
            operation.depthView = depthView;
            this._assertGeneration(generation);

            const previousTextures = new Set([
                this._renderTexture,
                this._depthTexture,
            ].filter(Boolean));
            this.baseWidth = baseWidth;
            this.baseHeight = baseHeight;
            this._currentScale = scale;
            this._renderTexture = operation.renderTexture;
            this._renderView = operation.renderView;
            this._depthTexture = operation.depthTexture;
            this._depthView = operation.depthView;
            operation.renderTexture = null;
            operation.renderView = null;
            operation.depthTexture = null;
            operation.depthView = null;
            operation.retired = true;
            this._textureOperations.delete(operation);

            for (const texture of previousTextures) {
                if (texture === this._renderTexture || texture === this._depthTexture) continue;
                try { texture.destroy?.(); } catch (_) {}
            }
            this._assertGeneration(generation);
        } catch (error) {
            this._retireTextureOperation(operation);
            this._assertGeneration(generation);
            throw error;
        }
    }

    _retireTextureOperation(operation) {
        if (!operation || operation.retired) return false;
        operation.retired = true;
        this._textureOperations.delete(operation);
        const textures = new Set([
            operation.renderTexture,
            operation.depthTexture,
        ].filter(Boolean));
        operation.renderTexture = null;
        operation.renderView = null;
        operation.depthTexture = null;
        operation.depthView = null;
        for (const texture of textures) {
            try { texture.destroy?.(); } catch (_) {}
        }
        return true;
    }

    _lifecycleError(reason = 'destroyed') {
        const error = new Error(`[DynamicViewport] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_DYNAMIC_VIEWPORT_DESTROYED';
        return error;
    }

    _parentInvalidated() {
        return this.vgpu?._destroyed === true
            || (this._parentFactoryGeneration !== null
                && this.vgpu?._factoryGeneration !== this._parentFactoryGeneration);
    }

    _assertAlive() {
        if (!this._destroyed && this._parentInvalidated()) this.destroy();
        if (this._destroyed) throw this._destroyError || this._lifecycleError();
    }

    _assertGeneration(generation) {
        this._assertAlive();
        if (generation !== this._generation) {
            throw this._destroyError || this._lifecycleError('generation invalidated');
        }
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._destroyError = this._lifecycleError();
        for (const operation of [...this._textureOperations]) {
            this._retireTextureOperation(operation);
        }
        const textures = new Set([
            this._renderTexture,
            this._depthTexture,
        ].filter(Boolean));
        this._renderTexture = null;
        this._depthTexture = null;
        this._renderView = null;
        this._depthView = null;
        for (const texture of textures) {
            try { texture.destroy?.(); } catch (_) {}
        }
        return true;
    }
}
