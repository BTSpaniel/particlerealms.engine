// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



import { createCanvasContext, resizeCanvasContext } from "../gpu/GpuCanvas.js";



function resolveCanvasElement(target) {

  if (!target) {

    throw new Error("PlatformCanvas: canvas target is required");

  }



  if (typeof document === "undefined") {

    throw new Error("PlatformCanvas: document is not available (not running in a browser)");

  }



  if (typeof target === "string") {

    const element = document.querySelector(target);

    if (!element) {

      throw new Error(`PlatformCanvas: no canvas found for selector '${target}'`);

    }

    return element;

  }



  if (target instanceof HTMLCanvasElement) {

    return target;

  }



  throw new Error(

    "PlatformCanvas: canvas target must be a CSS selector string or an HTMLCanvasElement"

  );

}


function getDevicePixelRatio() {

  if (typeof window !== "undefined" && typeof window.devicePixelRatio === "number") {

    return window.devicePixelRatio || 1;

  }

  return 1;

}



function computeCanvasPixelSize(canvas, dprMode, fixedDpr, maxDim) {

  const rect = canvas.getBoundingClientRect();

  let dpr = fixedDpr || 1;

  if (dprMode === "auto") {

    dpr = getDevicePixelRatio();

  }



  const limit = maxDim || 8192;

  const width = Math.max(1, Math.min(Math.floor(rect.width * dpr), limit));

  const height = Math.max(1, Math.min(Math.floor(rect.height * dpr), limit));



  return { width, height, devicePixelRatio: dpr };

}



export function createCanvasSurface(gpuDevice, canvasTarget, options = {}) {

  if (!gpuDevice) {

    throw new Error("createCanvasSurface: gpuDevice is required");

  }



  const canvas = resolveCanvasElement(canvasTarget);

  const dprMode = options.dprMode === "fixed" ? "fixed" : "auto";

  const fixedDpr = options.devicePixelRatio || 1;



  const canvasContext = createCanvasContext(gpuDevice, canvas, {

    format: options.format,

    alphaMode: options.alphaMode,

    presentationProfile: options.presentationProfile,

    colorSpace: options.colorSpace,

    toneMapping: options.toneMapping,

    viewFormats: options.viewFormats,

  });



  // Clamp canvas dimensions to device max (WebGPU best practice — webgpufundamentals.org)

  const maxDim = gpuDevice.maxTextureDimension2D || gpuDevice.limits?.maxTextureDimension2D || 8192;



  const resizeListeners = new Set();



  function notifyResize(info) {

    for (const listener of resizeListeners) {

      try {

        listener(info);

      } catch (error) {

        console.error("CanvasSurface resize listener error", error);

      }

    }

  }



  function applySizeFromEntry(entry) {

    // Prefer devicePixelContentBoxSize for pixel-perfect sizing (webgpufundamentals.org)

    // Falls back to contentBoxSize * dpr if not supported (e.g. Safari)

    let w, h;

    if (dprMode === "auto" && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0]) {

      w = entry.devicePixelContentBoxSize[0].inlineSize;

      h = entry.devicePixelContentBoxSize[0].blockSize;

    } else if (entry.contentBoxSize && entry.contentBoxSize[0]) {

      const dpr = dprMode === "auto" ? getDevicePixelRatio() : (fixedDpr || 1);

      w = Math.floor(entry.contentBoxSize[0].inlineSize * dpr);

      h = Math.floor(entry.contentBoxSize[0].blockSize * dpr);

    } else {

      applySize();

      return;

    }

    w = Math.max(1, Math.min(w, maxDim));

    h = Math.max(1, Math.min(h, maxDim));

    applyPixelSize(w, h, dprMode === "auto" ? getDevicePixelRatio() : fixedDpr);

  }



  function applySize() {

    const sizeInfo = computeCanvasPixelSize(canvas, dprMode, fixedDpr, maxDim);

    applyPixelSize(sizeInfo.width, sizeInfo.height, sizeInfo.devicePixelRatio);

  }



  try {

    applySize();

  } catch (error) {

    try { canvasContext.context.unconfigure(); } catch (_) {}

    throw error;

  }



  function onResize(listener) {

    if (typeof listener === "function") {

      resizeListeners.add(listener);

    }

    return () => {

      resizeListeners.delete(listener);

    };

  }



  function removeResizeListener(listener) {

    resizeListeners.delete(listener);

  }



  let resizeObserver = null;



  if (typeof ResizeObserver !== "undefined") {

    resizeObserver = new ResizeObserver((entries) => {

      for (const entry of entries) {

        if (entry.target === canvas) {

          try {

            applySizeFromEntry(entry);

          } catch (error) {

            console.error("CanvasSurface resize failed", error);

          }

        }

      }

    });

    // Request devicePixelContentBoxSize if supported

    try {

      resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });

    } catch (_) {

      resizeObserver.observe(canvas);

    }

  }



  function handleWindowResize() {

    try {

      applySize();

    } catch (error) {

      console.error("CanvasSurface resize failed", error);

    }

  }



  if (typeof window !== "undefined") {

    window.addEventListener("resize", handleWindowResize);

  }



  let destroyed = false;

  function destroy() {

    if (destroyed) return;

    destroyed = true;

    if (resizeObserver) {

      resizeObserver.disconnect();

      resizeObserver = null;

    }



    if (typeof window !== "undefined") {

      window.removeEventListener("resize", handleWindowResize);

    }



    resizeListeners.clear();

    try { canvasContext.context.unconfigure(); } catch (_) {}

  }



  function applyPixelSize(width, height, devicePixelRatio) {

    const w = Math.max(1, Math.min(Math.floor(width), maxDim));

    const h = Math.max(1, Math.min(Math.floor(height), maxDim));

    if (canvas.width === w && canvas.height === h) return false;

    const previous = { width: canvas.width, height: canvas.height };

    let transaction = null;

    try {

      transaction = options.stageResize?.({ canvas, width: w, height: h, devicePixelRatio }) || null;

      if (transaction && (typeof transaction.commit !== "function" || typeof transaction.rollback !== "function")) {

        throw new TypeError("PlatformCanvas stageResize must return a commit/rollback transaction");

      }

      resizeCanvasContext(canvasContext, w, h);

      transaction?.commit();

      notifyResize({ width: w, height: h, devicePixelRatio });

      return true;

    } catch (error) {

      canvas.width = previous.width;

      canvas.height = previous.height;

      try { transaction?.rollback(); } catch (_) {}

      options.onResizeError?.(error);

      throw error;

    }

  }



  return {

    gpuDevice,

    canvas,

    context: canvasContext.context,

    format: canvasContext.format,

    alphaMode: canvasContext.alphaMode,

    usage: canvasContext.usage,

    requestedPresentation: canvasContext.requestedPresentation,

    appliedConfiguration: canvasContext.appliedConfiguration,

    presentationFallback: canvasContext.presentationFallback,

    getPixelRatio() {

      return dprMode === "auto" ? getDevicePixelRatio() : fixedDpr;

    },

    getCanvasSize() {

      return { width: canvas.width, height: canvas.height };

    },

    onResize,

    removeResizeListener,

    resizeNow: applySize,

    destroy,

  };

}



export function createViewportManager(gpuDevice, options = {}) {

  if (!gpuDevice) {

    throw new Error("createViewportManager: gpuDevice is required");

  }



  const viewports = new Map();



  function addViewport(id, canvasTarget, viewportOptions = {}) {

    if (!id) {

      throw new Error("createViewportManager.addViewport: id is required");

    }

    if (viewports.has(id)) {

      throw new Error(`createViewportManager: viewport '${id}' already exists`);

    }



    const surface = createCanvasSurface(gpuDevice, canvasTarget, {

      ...options.defaultCanvasOptions,

      ...viewportOptions,

    });



    viewports.set(id, surface);

    return surface;

  }



  function removeViewport(id) {

    const surface = viewports.get(id);

    if (!surface) {

      return;

    }

    surface.destroy();

    viewports.delete(id);

  }



  function getViewport(id) {

    return viewports.get(id) || null;

  }



  function resizeAll() {

    for (const surface of viewports.values()) {

      surface.resizeNow();

    }

  }



  function destroyAll() {

    for (const surface of viewports.values()) {

      surface.destroy();

    }

    viewports.clear();

  }



  return {

    gpuDevice,

    addViewport,

    removeViewport,

    getViewport,

    resizeAll,

    destroyAll,

  };

}
