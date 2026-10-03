// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



export function getPreferredCanvasFormat() {

  if (

    typeof navigator !== "undefined" &&

    navigator.gpu &&

    typeof navigator.gpu.getPreferredCanvasFormat === "function"

  ) {

    return navigator.gpu.getPreferredCanvasFormat();

  }

  return "bgra8unorm";

}



export const DEFAULT_COLOR_FORMAT = getPreferredCanvasFormat();

export const DEFAULT_DEPTH_FORMAT = "depth24plus";

export const DEFAULT_SAMPLE_COUNT = 1;



export function isDepthFormatSupported(device, format) {

  try {

    const texture = device.createTexture({

      size: { width: 1, height: 1, depthOrArrayLayers: 1 },

      format,

      usage: GPUTextureUsage.RENDER_ATTACHMENT,

    });

    if (typeof texture.destroy === "function") {

      texture.destroy();

    }

    return true;

  } catch (error) {

    console.warn("Depth format not supported", format, error);

    return false;

  }

}

