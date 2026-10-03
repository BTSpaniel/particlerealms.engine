// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ReconstructionProvider.js - Unified Upscaling & Reconstruction Interface
 * 
 * Abstracts over multiple reconstruction backends:
 *   - TSR (Temporal Super-Resolution) - best quality, uses temporal history
 *   - FSR (FidelityFX Super Resolution) - spatial only, fallback for camera cuts
 *   - SVGF (Denoiser) - for path-traced/GI content
 *   - Native TAA - no upscaling, just anti-aliasing
 *   - None - passthrough
 * 
 * Future-proofed for:
 *   - WebNN neural upscaling (when browser API matures)
 *   - Custom ML models via WebGPU compute
 * 
 * Usage:
 *   const provider = new ReconstructionProvider(device);
 *   await provider.init(displayWidth, displayHeight);
 *   provider.setMode('tsr', TSRQuality.QUALITY);
 *   
 *   // In render loop:
 *   const { width, height } = provider.getRenderSize();
 *   const jitteredProj = provider.applyJitter(projMatrix);
 *   // ... render scene at width×height ...
 *   provider.execute(encoder, colorTex, depthTex, motionTex, outputTex);
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { TemporalSuperResolution, TSRQuality } from './TemporalSuperResolution.js';
import { FSRPass } from './FSRPass.js';
import { SVGFDenoise } from './SVGFDenoise.js';

// ============================================================================
// RECONSTRUCTION MODES
// ============================================================================

export const ReconstructionMode = {
    NONE: 'none',           // Passthrough - no processing
    TAA: 'taa',             // Native TAA only (no upscaling)
    TSR: 'tsr',             // Temporal Super-Resolution (best quality)
    FSR: 'fsr',             // Spatial upscaling only (no temporal)
    TSR_FSR: 'tsr+fsr',     // TSR with FSR fallback on camera cuts
};

// ============================================================================
// RECONSTRUCTION PROVIDER
// ============================================================================

export class ReconstructionProvider {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.initialized = false;

        // Active mode
        this.mode = ReconstructionMode.TSR;

        // Backends
        this.tsr = new TemporalSuperResolution(device);
        this.fsr = new FSRPass();
        this.svgf = new SVGFDenoise(device);

        // Display dimensions
        this.displayWidth = 0;
        this.displayHeight = 0;

        // Stats
        this._lastMode = null;
        this._framesSinceReset = 0;
    }

    /**
     * Initialize all backends
     */
    async init(displayWidth, displayHeight, options = {}) {
        this.displayWidth = displayWidth;
        this.displayHeight = displayHeight;

        const quality = options.tsrQuality || TSRQuality.QUALITY;
        this.tsr.quality = quality;

        // Initialize TSR
        await this.tsr.init(displayWidth, displayHeight);

        // Initialize FSR with TSR's render dimensions
        const renderSize = this.tsr.getRenderSize();
        await this.fsr.init(this.device, renderSize.width, renderSize.height, displayWidth, displayHeight);

        // Initialize SVGF at render resolution (denoising happens before upscale)
        await this.svgf.init(renderSize.width, renderSize.height);

        this.initialized = true;
        console.log(`[ReconstructionProvider] Initialized: mode=${this.mode}, display=${displayWidth}×${displayHeight}, render=${renderSize.width}×${renderSize.height}`);
    }

    /**
     * Set reconstruction mode
     */
    setMode(mode, tsrQuality) {
        this.mode = mode;
        if (tsrQuality && this.initialized) {
            this.tsr.setQuality(tsrQuality);
            const rs = this.tsr.getRenderSize();
            this.fsr.resize(rs.width, rs.height, this.displayWidth, this.displayHeight);
            this.svgf.resize(rs.width, rs.height);
        }
        console.log(`[ReconstructionProvider] Mode: ${mode}`);
    }

    /**
     * Set TSR quality preset
     */
    setTSRQuality(preset) {
        this.tsr.setQuality(preset);
        if (this.initialized) {
            const rs = this.tsr.getRenderSize();
            this.fsr.resize(rs.width, rs.height, this.displayWidth, this.displayHeight);
            this.svgf.resize(rs.width, rs.height);
        }
    }

    /**
     * Get render dimensions (render your scene at this size)
     */
    getRenderSize() {
        if (this.mode === ReconstructionMode.NONE || this.mode === ReconstructionMode.TAA) {
            return { width: this.displayWidth, height: this.displayHeight };
        }
        return this.tsr.getRenderSize();
    }

    /**
     * Get display dimensions
     */
    getDisplaySize() {
        return { width: this.displayWidth, height: this.displayHeight };
    }

    /**
     * Get sub-pixel jitter for projection matrix
     */
    getJitter() {
        if (this.mode === ReconstructionMode.NONE || this.mode === ReconstructionMode.FSR) {
            return { x: 0, y: 0 };
        }
        return this.tsr.getJitter();
    }

    /**
     * Apply jitter to projection matrix (returns jittered copy)
     */
    applyJitter(projMatrix) {
        if (this.mode === ReconstructionMode.NONE || this.mode === ReconstructionMode.FSR) {
            return projMatrix;
        }
        return this.tsr.applyJitter(projMatrix);
    }

    /**
     * Signal camera cut / teleport (resets temporal history)
     */
    signalCameraCut() {
        this.tsr.signalCameraCut();
        this.svgf.signalCameraCut();
        this._framesSinceReset = 0;
    }

    /**
     * Resize for new display dimensions
     */
    resize(displayWidth, displayHeight) {
        if (displayWidth === this.displayWidth && displayHeight === this.displayHeight) return;
        this.displayWidth = displayWidth;
        this.displayHeight = displayHeight;

        this.tsr.resize(displayWidth, displayHeight);
        const rs = this.tsr.getRenderSize();
        this.fsr.resize(rs.width, rs.height, displayWidth, displayHeight);
        this.svgf.resize(rs.width, rs.height);
    }

    /**
     * Execute reconstruction pass
     * 
     * For TSR/FSR modes:
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} colorTexture    - Scene color at render resolution
     * @param {GPUTexture} depthTexture    - Depth at render resolution
     * @param {GPUTexture} motionTexture   - Motion vectors at render resolution
     * @param {GPUTexture} outputTexture   - Output at display resolution (storage)
     */
    execute(encoder, colorTexture, depthTexture, motionTexture, outputTexture) {
        if (!this.initialized) return;

        switch (this.mode) {
            case ReconstructionMode.TSR:
                this.tsr.execute(encoder, colorTexture, depthTexture, motionTexture, outputTexture);
                break;

            case ReconstructionMode.FSR:
                this.fsr.execute(encoder, colorTexture, outputTexture);
                break;

            case ReconstructionMode.TSR_FSR:
                // Use FSR for first 2 frames after reset (no history), then TSR
                if (this._framesSinceReset < 2) {
                    this.fsr.execute(encoder, colorTexture, outputTexture);
                } else {
                    this.tsr.execute(encoder, colorTexture, depthTexture, motionTexture, outputTexture);
                }
                break;

            case ReconstructionMode.NONE:
            case ReconstructionMode.TAA:
                // Passthrough - copy input to output if sizes differ, otherwise no-op
                // Caller handles TAA separately via existing TAAPass
                break;
        }

        this._framesSinceReset++;
    }

    /**
     * Execute SVGF denoising (separate from upscaling)
     * Call this on noisy path-traced input BEFORE upscaling.
     * 
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} noisyColor   - Noisy GI/path-trace output
     * @param {GPUTexture} normalTex    - World normals (0-1 packed)
     * @param {GPUTexture} depthTex     - Linear depth
     * @param {GPUTexture} motionTex    - Motion vectors
     * @param {GPUTexture} outputTex    - Denoised output (storage)
     */
    executeDenoise(encoder, noisyColor, normalTex, depthTex, motionTex, outputTex) {
        if (!this.initialized || !this.svgf.enabled) return;
        this.svgf.execute(encoder, noisyColor, normalTex, depthTex, motionTex, outputTex);
    }

    /**
     * Get info about current state
     */
    getInfo() {
        const rs = this.getRenderSize();
        const ds = this.getDisplaySize();
        const scale = rs.width / ds.width;
        return {
            mode: this.mode,
            renderWidth: rs.width,
            renderHeight: rs.height,
            displayWidth: ds.width,
            displayHeight: ds.height,
            renderScale: scale,
            upscaleFactor: (1 / scale).toFixed(2) + 'x',
            tsrQuality: this.tsr.quality.name,
            svgfIterations: this.svgf.atrousIterations,
            fsrSharpness: this.fsr.sharpness,
        };
    }

    /**
     * Load configuration from engine.cfg
     */
    loadConfig(cfg) {
        if (!cfg) return;

        if (cfg.mode) this.mode = cfg.mode;
        if (cfg.tsr) this.tsr.loadConfig(cfg.tsr);
        if (cfg.fsr) this.fsr.loadConfig(cfg.fsr);
        if (cfg.svgf) this.svgf.loadConfig(cfg.svgf);

        if (cfg.tsr_quality) {
            const key = cfg.tsr_quality.toUpperCase().replace(/\s+/g, '_');
            if (TSRQuality[key]) {
                this.setTSRQuality(TSRQuality[key]);
            }
        }
    }

    destroy() {
        this.tsr.destroy();
        this.fsr.destroy();
        this.svgf.destroy();
        this.initialized = false;
    }
}

export default ReconstructionProvider;
