// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



import { DEFAULT_COLOR_FORMAT, getPreferredCanvasFormat } from "./GpuFormats.js";



export function createCanvasContext(gpuDevice, canvas, options = {}) {

  if (!canvas) {

    throw new Error("Canvas element is required to create a WebGPU context");

  }



  const context = canvas.getContext("webgpu");

  if (!context) {

    throw new Error("Failed to acquire WebGPU canvas context");

  }



  const device = gpuDevice.getDevice();

  const format =

    options.format || getPreferredCanvasFormat() || DEFAULT_COLOR_FORMAT;

  const alphaMode = options.alphaMode || "opaque";



  // Cross-browser safe canvas usage (Safari/Metal may not support COPY_DST on swapchain)

  const usage = gpuDevice.capabilities?.safeCanvasUsage

    ?? (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST);



  const baseConfiguration = { device, format, alphaMode, usage };

  if (Array.isArray(options.viewFormats) && options.viewFormats.length > 0) {

    baseConfiguration.viewFormats = [...new Set(options.viewFormats)];

  }

  const requestedPresentation = normalizePresentationOptions(options);

  const requestedConfiguration = { ...baseConfiguration, ...requestedPresentation };

  let presentationFallback = null;

  try {

    context.configure(requestedConfiguration);

  } catch (error) {

    if (!requestedPresentation.colorSpace && !requestedPresentation.toneMapping) throw error;

    context.configure(baseConfiguration);

    presentationFallback = Object.freeze({

      requested: Object.freeze({ ...requestedPresentation }),

      reason: String(error?.message ?? error),

    });

  }

  const appliedConfiguration = typeof context.getConfiguration === "function"

    ? context.getConfiguration()

    : (presentationFallback ? baseConfiguration : requestedConfiguration);



  return {

    canvas,

    context,

    format,

    alphaMode,

    usage,

    requestedPresentation: Object.freeze({ ...requestedPresentation }),

    appliedConfiguration,

    presentationFallback,

  };

}



export function resizeCanvasContext(canvasContext, width, height) {

  const { canvas } = canvasContext;

  if (!canvas) {

    return;

  }



  const w = Math.max(1, Math.floor(width));

  const h = Math.max(1, Math.floor(height));



  if (canvas.width === w && canvas.height === h) {

    return false;

  }



  canvas.width = w;

  canvas.height = h;

  return true;

}


function normalizePresentationOptions(options) {

  const profile = String(options.presentationProfile || "").toLowerCase();

  const requestedColorSpace = options.colorSpace

    || (profile === "display-p3" || profile === "extended-hdr" ? "display-p3" : null);

  const colorSpace = requestedColorSpace === "display-p3" ? "display-p3"

    : requestedColorSpace === "srgb" ? "srgb"

    : null;

  const requestedToneMapping = options.toneMapping

    || (profile === "extended-hdr" ? { mode: "extended" } : null);

  const mode = typeof requestedToneMapping === "string"

    ? requestedToneMapping

    : requestedToneMapping?.mode;

  const toneMapping = mode === "extended" || mode === "standard" ? { mode } : null;

  return {

    ...(colorSpace ? { colorSpace } : {}),

    ...(toneMapping ? { toneMapping } : {}),

  };

}
