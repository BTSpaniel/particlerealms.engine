// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GpuInit.js - GPU initialization helpers
 * 
 * Simplifies WebGPU canvas initialization and state population.
 */

import { initWebGpuCanvas } from "./WebGpuCanvasBootstrap.js";

/**
 * Initialize WebGPU and populate GPU state object.
 * @param {Object} options - Initialization options
 * @param {Object} options.gpu - GPU state object to populate
 * @param {string} options.canvasSelector - Canvas selector (default: "#canvas")
 * @param {string} options.label - Device label
 * @param {string} options.alphaMode - Alpha mode (default: "opaque")
 * @param {string} options.dprMode - DPR mode (default: "auto")
 * @param {Function} options.logger - Optional logger
 * @returns {Promise<Object>} { device, queue, context, format }
 */
export async function initGpuState(options) {
  const {
    gpu,
    canvasSelector = "#canvas",
    label = "WebGPUDevice",
    alphaMode = "opaque",
    dprMode = "auto",
    logger,
  } = options;

  try {
    const ctx = await initWebGpuCanvas({
      canvasSelector,
      label,
      alphaMode,
      dprMode,
      logger,
    });

    // Populate GPU state
    gpu.device = ctx.gpuDevice;
    gpu.queue = ctx.gpuQueue;
    gpu.surface = ctx.canvasSurface;
    gpu.context = ctx.context;
    gpu.depthTexture = ctx.depthTexture;
    gpu.depthTextureView = ctx.depthTextureView;

    return {
      device: gpu.device.getDevice(),
      queue: gpu.queue,
      context: gpu.context,
      format: ctx.format,
      dispose: () => ctx.dispose(),
    };
  } catch (err) {
    if (logger) {
      logger.error(`GPU init failed: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Check if WebGPU is supported.
 * @returns {boolean}
 */
export function isWebGpuSupported() {
  return "gpu" in navigator;
}

/**
 * Wait for canvas to be properly sized before GPU init.
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number} minSize - Minimum size in pixels (default: 1)
 * @returns {Promise<void>}
 */
export function waitForCanvasReady(canvas, minSize = 1) {
  return new Promise((resolve) => {
    const checkSize = () => {
      if (canvas.clientWidth > minSize && canvas.clientHeight > minSize) {
        resolve();
      } else {
        requestAnimationFrame(checkSize);
      }
    };
    checkSize();
  });
}
