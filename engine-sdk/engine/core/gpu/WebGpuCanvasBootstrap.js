// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getGpuDevice } from './GpuDevice.js';
import { createCanvasSurface } from '../platform/PlatformCanvas.js';

/**
 * Initialize one Engine canvas with a single size/configuration owner.
 * PlatformCanvas owns context configuration, DPR policy, observation, and
 * disposal. This bootstrap owns only the depth target derived from that size.
 */
export async function initWebGpuCanvas(options = {}) {
  const {
    canvasSelector = '#canvas',
    label = 'EngineWebGPUDevice',
    profile = 'baseline-render',
    alphaMode = 'opaque',
    dprMode = 'auto',
    devicePixelRatio = 1,
    presentationProfile,
    colorSpace,
    toneMapping,
    viewFormats,
    format,
    depthFormat = 'depth24plus',
    logger = null,
  } = options;

  const canvas = typeof canvasSelector === 'string'
    ? document.querySelector(canvasSelector)
    : canvasSelector;
  if (!canvas) {
    const message = `Canvas ${String(canvasSelector)} not found`;
    logger?.error?.(message);
    throw new Error(message);
  }

  const gpuDevice = options.gpuDevice || await getGpuDevice({ label, profile });
  const gpuQueue = gpuDevice.getQueue();
  const device = gpuDevice.getDevice();
  let depthTexture = null;
  let depthTextureView = null;
  let canvasSurface = null;
  let removeDepthResize = null;
  let disposed = false;
  let initialized = false;

  const cleanup = () => {
    if (disposed) return false;
    disposed = true;
    try { removeDepthResize?.(); } catch (_) {}
    removeDepthResize = null;
    try { depthTexture?.destroy(); } catch (_) {}
    depthTexture = null;
    depthTextureView = null;
    try { canvasSurface?.destroy(); } catch (_) {}
    canvasSurface = null;
    return true;
  };

  const stageDepthTarget = ({ width, height }) => {
    if (disposed) throw new Error('Canvas bootstrap is disposed');
    const replacement = device.createTexture({
      label: `${label}.Depth`,
      size: [Math.max(1, width), Math.max(1, height)],
      format: depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    let replacementView;
    try {
      replacementView = replacement.createView();
    } catch (error) {
      try { replacement.destroy(); } catch (_) {}
      throw error;
    }
    let state = 'staged';
    return {
      commit() {
        if (state !== 'staged') throw new Error(`Depth resize transaction is ${state}`);
        const previous = depthTexture;
        depthTexture = replacement;
        depthTextureView = replacementView;
        state = 'committed';
        try { previous?.destroy(); } catch (_) {}
      },
      rollback() {
        if (state !== 'staged') return false;
        state = 'rolled-back';
        try { replacement.destroy(); } catch (_) {}
        return true;
      },
    };
  };

  try {
    canvasSurface = createCanvasSurface(gpuDevice, canvas, {
      dprMode,
      devicePixelRatio,
      format,
      alphaMode,
      presentationProfile,
      colorSpace,
      toneMapping,
      viewFormats,
      stageResize: stageDepthTarget,
      onResizeError: error => logger?.error?.(
        `[CANVAS] Depth target resize failed: ${error?.message ?? error}`,
      ),
    });
    const context = canvasSurface.context;
    if (!depthTexture) {
      const initialDepth = stageDepthTarget({ width: canvas.width, height: canvas.height });
      try {
        initialDepth.commit();
      } catch (error) {
        initialDepth.rollback();
        throw error;
      }
    }
    removeDepthResize = canvasSurface.onResize(({ width, height }) => {
      logger?.info?.(`[CANVAS] Resized to ${width}x${height}`);
    });

    logger?.info?.('GPU initialized with WebGPU');
    logger?.info?.(`Canvas: ${canvas.width}x${canvas.height}`);
    logger?.info?.(`Canvas client: ${canvas.clientWidth}x${canvas.clientHeight}`);
    logger?.info?.(`Canvas style: ${canvas.style.width}x${canvas.style.height}`);
    logger?.info?.(`Format: ${canvasSurface.format}`);
    if (canvasSurface.presentationFallback) {
      logger?.warn?.(`[CANVAS] Presentation profile fallback: ${canvasSurface.presentationFallback.reason}`);
    }

    const result = {
      canvas,
      gpuDevice,
      gpuQueue,
      canvasSurface,
      context,
      get depthTexture() { return depthTexture; },
      get depthTextureView() { return depthTextureView; },
      format: canvasSurface.format,
      resizeCanvas() {
        if (!disposed) canvasSurface.resizeNow();
      },
      dispose: cleanup,
    };

    initialized = true;
    return result;
  } finally {
    if (!initialized) cleanup();
  }
}
