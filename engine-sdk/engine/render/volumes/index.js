// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Volumetric Rendering System - Index
 * 
 * Exports all volumetric rendering components for easy import.
 * 
 * Quick Start:
 *   import { VolumeIntegration, VolumeRenderMode } from './volumes/index.js';
 *   
 *   const volume = new VolumeIntegration(device, { format, width, height });
 *   await volume.init();
 *   volume.connectParticles('particles', particleRenderer);
 *   
 *   // In render loop:
 *   volume.configureSmokeMode({ densityScale: 1.5 });
 *   // or
 *   volume.configureWaterMode({ refractionIndex: 1.33 });
 *   
 *   volume.update(encoder, camera);
 *   volume.render(pass, sceneColor, sceneDepth);
 */

// Core systems
export { HybridVolumeSystem, VolumeRenderMode } from './HybridVolumeSystem.js';
export { UnifiedVolumeRenderer } from './UnifiedVolumeRenderer.js';

// Integration helpers
export { VolumeIntegration, createVolumeIntegration } from './VolumeIntegration.js';
export { ParticleVolumeConnector, createParticleVolumeConnector } from './ParticleVolumeConnector.js';

// Existing renderers (for reference/compatibility)
export { createSmokeVolumeRenderer } from './SmokeVolumeRenderer.js';
export { createIsoSurfaceVolumeRenderer } from './IsoSurfaceVolumeRenderer.js';

// Re-export DualModeRenderer for LOD blending
import { DualModeRenderer, ViewMode, LOD_THRESHOLDS } from '../DualModeRenderer.js';
export { DualModeRenderer, ViewMode, LOD_THRESHOLDS };

// Re-export VolumetricRaymarcher for direct grid rendering
import { VolumetricRaymarcher, RenderMode, DEFAULT_PARAMS } from '../VolumetricRaymarch.js';
export { VolumetricRaymarcher, RenderMode, DEFAULT_PARAMS };

/**
 * Quick factory to create a complete volumetric setup
 * @param {GPUDevice} device
 * @param {Object} options
 * @returns {Promise<VolumeIntegration>}
 */
export async function createVolumetricSystem(device, options = {}) {
  const { VolumeIntegration } = await import('./VolumeIntegration.js');
  
  const volume = new VolumeIntegration(device, {
    format: options.format || 'bgra8unorm',
    width: options.width || 1920,
    height: options.height || 1080,
    gridResolution: options.gridResolution || 64,
    volumeSize: options.volumeSize || 50,
    splatRadius: options.splatRadius || 1.0,
    densityScale: options.densityScale || 1.0,
    ...options
  });
  
  await volume.init();
  
  // Auto-configure based on mode
  if (options.mode === 'smoke' || options.mode === VolumeRenderMode.SMOKE) {
    volume.configureSmokeMode(options);
  } else if (options.mode === 'water' || options.mode === VolumeRenderMode.WATER) {
    volume.configureWaterMode(options);
  }
  
  console.log('[Volumes] Created volumetric system:', volume.getStats());
  
  return volume;
}
