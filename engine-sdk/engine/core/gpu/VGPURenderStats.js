// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Render Statistics - Draw call counts, triangle counts, state changes per frame
 */

export class VGPURenderStats {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this._destroyed = false;
        this._generation = 0;
        this._overlays = new Set();
        this._terminalSnapshot = Object.freeze(this._createStats());
        
        // Current frame stats
        this._current = this._createStats();
        
        // Previous frame (for comparison)
        this._previous = this._createStats();
        
        // Accumulated stats
        this._accumulated = this._createStats();
        this._frameCount = 0;
        
        // History ring buffer (avoids push/shift O(n))
        this._historySize = 120;  // 2 seconds at 60fps
        this._history = new Array(this._historySize);
        this._historyIndex = 0;
        this._historyCount = 0;
        
        // Stat field names cached once for fast iteration
        this._statKeys = Object.keys(this._current);
        
        // Tracking state
        this._currentPipeline = null;
        this._currentBindGroups = new Array(4).fill(null);
        this._currentVertexBuffers = new Array(8).fill(null);
        this._currentIndexBuffer = null;
    }

    _canMutate() {
        return !this._destroyed;
    }

    _registerOverlay(overlay) {
        if (this._destroyed || !this._overlays) return false;
        this._overlays.add(overlay);
        return true;
    }

    _releaseOverlay(overlay) {
        this._overlays?.delete(overlay);
    }

    _createStats() {
        return {
            drawCalls: 0,
            drawCallsIndexed: 0,
            drawCallsInstanced: 0,
            drawCallsIndirect: 0,
            dispatchCalls: 0,
            
            triangles: 0,
            vertices: 0,
            instances: 0,
            
            pipelineChanges: 0,
            bindGroupChanges: 0,
            vertexBufferChanges: 0,
            indexBufferChanges: 0,
            
            renderPasses: 0,
            computePasses: 0,
            
            textureBinds: 0,
            bufferBinds: 0,
            
            blitOperations: 0,
            clearOperations: 0,
            
            frameTimeMs: 0,
            gpuTimeMs: 0,
        };
    }

    /**
     * Begin a new frame
     */
    beginFrame() {
        if (!this._canMutate()) return false;
        // Copy current → previous in-place (no object allocation)
        const keys = this._statKeys;
        const prev = this._previous, cur = this._current;
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            prev[k] = cur[k];
            cur[k] = 0;
        }
        
        // Reset state tracking
        this._currentPipeline = null;
        this._currentBindGroups.fill(null);
        this._currentVertexBuffers.fill(null);
        this._currentIndexBuffer = null;
        return true;
    }

    /**
     * End the current frame
     */
    endFrame(frameTimeMs = 0, gpuTimeMs = 0) {
        if (!this._canMutate()) return false;
        this._current.frameTimeMs = frameTimeMs;
        this._current.gpuTimeMs = gpuTimeMs;
        
        // Accumulate in-place using cached keys
        const keys = this._statKeys;
        const acc = this._accumulated, cur = this._current;
        for (let i = 0; i < keys.length; i++) {
            acc[keys[i]] += cur[keys[i]];
        }
        this._frameCount++;
        
        // Ring buffer history (reuse entry objects in-place)
        const idx = this._historyIndex;
        let entry = this._history[idx];
        if (!entry) { entry = this._createStats(); entry.timestamp = 0; this._history[idx] = entry; }
        for (let i = 0; i < keys.length; i++) { entry[keys[i]] = cur[keys[i]]; }
        entry.timestamp = performance.now();
        this._historyIndex = (idx + 1) % this._historySize;
        if (this._historyCount < this._historySize) this._historyCount++;
        return true;
    }

    /**
     * Record a draw call
     */
    recordDraw(vertexCount, instanceCount = 1, indexed = false, indirect = false) {
        if (!this._canMutate()) return false;
        this._current.drawCalls++;
        this._current.vertices += vertexCount * instanceCount;
        this._current.instances += instanceCount;
        
        // Estimate triangles (assuming triangle list)
        this._current.triangles += Math.floor(vertexCount / 3) * instanceCount;
        
        if (indexed) this._current.drawCallsIndexed++;
        if (instanceCount > 1) this._current.drawCallsInstanced++;
        if (indirect) this._current.drawCallsIndirect++;
        return true;
    }

    /**
     * Record a compute dispatch
     */
    recordDispatch(workgroupsX = 1, workgroupsY = 1, workgroupsZ = 1) {
        if (!this._canMutate()) return false;
        this._current.dispatchCalls++;
        return true;
    }

    /**
     * Record a pipeline change
     */
    recordPipelineChange(pipeline) {
        if (!this._canMutate()) return false;
        if (pipeline !== this._currentPipeline) {
            this._current.pipelineChanges++;
            this._currentPipeline = pipeline;
        }
        return true;
    }

    /**
     * Record a bind group change
     */
    recordBindGroupChange(slot, bindGroup) {
        if (!this._canMutate()) return false;
        if (bindGroup !== this._currentBindGroups[slot]) {
            this._current.bindGroupChanges++;
            this._currentBindGroups[slot] = bindGroup;
        }
        return true;
    }

    /**
     * Record a vertex buffer change
     */
    recordVertexBufferChange(slot, buffer) {
        if (!this._canMutate()) return false;
        if (buffer !== this._currentVertexBuffers[slot]) {
            this._current.vertexBufferChanges++;
            this._currentVertexBuffers[slot] = buffer;
        }
        return true;
    }

    /**
     * Record an index buffer change
     */
    recordIndexBufferChange(buffer) {
        if (!this._canMutate()) return false;
        if (buffer !== this._currentIndexBuffer) {
            this._current.indexBufferChanges++;
            this._currentIndexBuffer = buffer;
        }
        return true;
    }

    /**
     * Record render pass begin
     */
    recordRenderPass() {
        if (!this._canMutate()) return false;
        this._current.renderPasses++;
        return true;
    }

    /**
     * Record compute pass begin
     */
    recordComputePass() {
        if (!this._canMutate()) return false;
        this._current.computePasses++;
        return true;
    }

    /**
     * Record texture bind
     */
    recordTextureBind(count = 1) {
        if (!this._canMutate()) return false;
        this._current.textureBinds += count;
        return true;
    }

    /**
     * Record buffer bind
     */
    recordBufferBind(count = 1) {
        if (!this._canMutate()) return false;
        this._current.bufferBinds += count;
        return true;
    }

    /**
     * Record blit/copy operation
     */
    recordBlit() {
        if (!this._canMutate()) return false;
        this._current.blitOperations++;
        return true;
    }

    /**
     * Record clear operation
     */
    recordClear() {
        if (!this._canMutate()) return false;
        this._current.clearOperations++;
        return true;
    }

    /**
     * Get current frame stats
     */
    getCurrent() {
        return this._destroyed ? this._terminalSnapshot : this._current;
    }

    /**
     * Get previous frame stats
     */
    getPrevious() {
        return this._destroyed ? this._terminalSnapshot : this._previous;
    }

    /**
     * Get average stats over all frames
     */
    getAverage() {
        if (this._destroyed) return this._terminalSnapshot;
        if (this._frameCount === 0) return this._createStats();
        
        const avg = {};
        for (const key of Object.keys(this._accumulated)) {
            avg[key] = this._accumulated[key] / this._frameCount;
        }
        return avg;
    }

    /**
     * Get formatted stats string
     */
    getStatsString() {
        const s = this._destroyed ? this._terminalSnapshot : this._current;
        return [
            `Draw Calls: ${s.drawCalls} (${s.drawCallsIndexed} indexed, ${s.drawCallsInstanced} instanced)`,
            `Triangles: ${this._formatNumber(s.triangles)} | Vertices: ${this._formatNumber(s.vertices)}`,
            `Dispatches: ${s.dispatchCalls}`,
            `State Changes: ${s.pipelineChanges} pipelines, ${s.bindGroupChanges} bind groups`,
            `Passes: ${s.renderPasses} render, ${s.computePasses} compute`,
            `Frame: ${s.frameTimeMs.toFixed(2)}ms | GPU: ${s.gpuTimeMs.toFixed(2)}ms`,
        ].join('\n');
    }

    /**
     * Get stats history for graphing
     */
    getHistory(stat = 'triangles') {
        if (this._destroyed || !this._history) return [];
        const count = this._historyCount, max = this._historySize;
        const start = count < max ? 0 : this._historyIndex;
        const result = new Array(count);
        for (let i = 0; i < count; i++) { result[i] = this._history[(start + i) % max][stat]; }
        return result;
    }

    /**
     * Get multiple stats as time series
     */
    getTimeSeries(stats = ['drawCalls', 'triangles', 'frameTimeMs']) {
        const series = {};
        for (const stat of stats) {
            series[stat] = this._destroyed ? [] : this.getHistory(stat);
        }
        return series;
    }

    /**
     * Reset all stats
     */
    reset() {
        if (!this._canMutate()) return false;
        this._current = this._createStats();
        this._previous = this._createStats();
        this._accumulated = this._createStats();
        this._frameCount = 0;
        this._history = new Array(this._historySize);
        this._historyIndex = 0;
        this._historyCount = 0;
        this._currentPipeline = null;
        this._currentBindGroups.fill(null);
        this._currentVertexBuffers.fill(null);
        this._currentIndexBuffer = null;
        return true;
    }

    /**
     * Get frame count
     */
    getFrameCount() {
        return this._destroyed ? 0 : this._frameCount;
    }

    _formatNumber(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    }

    /**
     * Terminally clear statistics, retained GPU references, and overlays.
     */
    destroy() {
        if (this._destroyed) return false;
        const overlays = this._overlays ? Array.from(this._overlays) : [];
        this._destroyed = true;
        this._generation++;
        this._overlays?.clear();
        this._overlays = null;
        this._current = this._terminalSnapshot;
        this._previous = this._terminalSnapshot;
        this._accumulated = this._terminalSnapshot;
        this._frameCount = 0;
        this._history?.fill(null);
        this._history = null;
        this._historySize = 0;
        this._historyIndex = 0;
        this._historyCount = 0;
        this._statKeys = null;
        this._currentPipeline = null;
        this._currentBindGroups?.fill(null);
        this._currentBindGroups = null;
        this._currentVertexBuffers?.fill(null);
        this._currentVertexBuffers = null;
        this._currentIndexBuffer = null;
        this.vgpu = null;

        for (const overlay of overlays) overlay.destroy();
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

/**
 * Stats overlay for debug display
 */
export class VGPUStatsOverlay {
    constructor(stats) {
        this.stats = stats;
        this._element = null;
        this._visible = false;
        this._updateInterval = null;
        this._destroyed = false;
        this._generation = 0;
        const registered = this.stats?._registerOverlay?.(this);
        if (registered === false) {
            this._destroyed = true;
            this.stats = null;
        }
    }

    _releasePresentation(element, interval) {
        if (interval !== null) {
            try { clearInterval(interval); } catch (_) {}
        }
        if (element) {
            try { element.remove(); } catch (_) {}
        }
    }

    /**
     * Create and show overlay
     */
    show(parentElement = document.body) {
        if (this._destroyed || this._element) return false;
        const generation = this._generation;
        const element = document.createElement('div');
        element.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #0f0;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 4px;
            z-index: 10000;
            white-space: pre;
            pointer-events: none;
        `;
        try {
            parentElement.appendChild(element);
        } catch (error) {
            this._releasePresentation(element, null);
            throw error;
        }
        if (this._destroyed || generation !== this._generation) {
            this._releasePresentation(element, null);
            return false;
        }

        const interval = setInterval(() => this._update(generation, element), 100);
        if (this._destroyed || generation !== this._generation) {
            this._releasePresentation(element, interval);
            return false;
        }

        this._element = element;
        this._updateInterval = interval;
        this._visible = true;
        return true;
    }

    /**
     * Hide overlay
     */
    hide() {
        if (this._destroyed) return false;
        const element = this._element;
        const interval = this._updateInterval;
        this._element = null;
        this._updateInterval = null;
        this._visible = false;
        this._releasePresentation(element, interval);
        return Boolean(element || interval !== null);
    }

    /**
     * Toggle visibility
     */
    toggle() {
        if (this._destroyed) return false;
        if (this._visible) {
            return this.hide();
        }
        return this.show();
    }

    _update(generation = this._generation, element = this._element) {
        if (
            this._destroyed
            || generation !== this._generation
            || !element
            || element !== this._element
        ) return;
        const text = this.stats.getStatsString();
        if (
            this._destroyed
            || generation !== this._generation
            || element !== this._element
        ) return;
        element.textContent = text;
    }

    destroy() {
        if (this._destroyed) return false;
        const stats = this.stats;
        this._destroyed = true;
        this._generation++;

        const element = this._element;
        const interval = this._updateInterval;
        this._element = null;
        this._updateInterval = null;
        this._visible = false;
        this.stats = null;

        stats?._releaseOverlay?.(this);
        this._releasePresentation(element, interval);
        return true;
    }

    dispose() {
        return this.destroy();
    }
}
