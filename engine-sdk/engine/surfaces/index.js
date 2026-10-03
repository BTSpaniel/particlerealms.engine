// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/index.js — Render Surfaces barrel (spec Phase 4).
//
// A RenderSurface turns a live source (canvas / code / terminal / camera /
// webgpu / image / video) into a GPU texture that can be mapped onto a mesh as
// baseColor or emissive and optionally receive pointer/keyboard input via UV
// hit-testing. The SurfaceManager owns texture lifetime + an update scheduler so
// nothing touches the GPU unless it must (dirty-only, interval-capped, slept when
// off-screen). Sources only ever render their OWN content (safety by design).

export {
  SURFACE_SOURCE, UPDATE_MODE, createRenderSurface,
  markSurfaceDirty, resizeSurface, surfaceNeedsUpload,
} from './RenderSurface.js';

export { createSurfaceManager, surfaceImageSource, surfaceImageReady } from './SurfaceManager.js';

export { canvasToBlob, make2DCanvas, createCanvasSurface } from './CanvasSurface.js';
export { createCodeSurface } from './CodeSurface.js';
export { createTerminalSurface } from './TerminalSurface.js';
export { createWebGPUSurface } from './WebGPUSurface.js';
export { createImageSurface, createVideoSurface, createCameraSurface } from './MediaSurface.js';

export {
  SURFACE_SLOT, SURFACE_SPACE, createSurfaceMaterial,
  surfaceTextureResource, materialSurfaceBinding, surfaceIdFromTextureId,
} from './RenderSurfaceMaterial.js';

export { createSurfaceInputMapper, uvToPixel } from './SurfaceInputMapper.js';
