// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VolumeIntegration.js - Easy Integration Helper for Hybrid Volumetrics
 * 
 * Provides a simple API to integrate the hybrid volume system with the engine.
 * Handles all the wiring between particle systems, meshes, and volume rendering.
 * 
 * Usage:
 *   const volume = new VolumeIntegration(device, { format, width, height });
 *   await volume.init();
 *   
 *   // Connect particle system
 *   volume.connectParticles(particleRenderer);
 *   
 *   // Or add mesh as particles
 *   volume.addMesh('myMesh', meshData);
 *   
 *   // In render loop:
 *   volume.update(encoder, camera);
 *   volume.render(pass, sceneColorTexture, sceneDepthTexture);
 */

import { HybridVolumeSystem, VolumeRenderMode } from './HybridVolumeSystem.js';
import { UnifiedVolumeRenderer } from './UnifiedVolumeRenderer.js';

export { VolumeRenderMode };

export class VolumeIntegration {
  /**
   * @param {GPUDevice} device
   * @param {Object} options
   */
  constructor(device, options = {}) {
    this.device = device;
    
    // Create subsystems
    this.volumeSystem = new HybridVolumeSystem(device, {
      gridResolution: options.gridResolution || 64,
      volumeSize: options.volumeSize || 50,
      splatRadius: options.splatRadius || 1.0,
      densityScale: options.densityScale || 1.0,
      colorBlend: options.colorBlend || 1.0,
      tripleBuffer: options.tripleBuffer ?? true,
      volumeMin: options.volumeMin,
      volumeMax: options.volumeMax,
    });
    
    this.volumeRenderer = new UnifiedVolumeRenderer(device, {
      format: options.format || 'bgra8unorm',
      width: options.width || 1920,
      height: options.height || 1080,
    });
    
    // Connected particle systems
    this.connectedParticleSystems = new Map();
    
    // Scene textures
    this.sceneColorTexture = null;
    this.sceneDepthTexture = null;
    
    // State
    this.initialized = false;
    this.enabled = true;
    this.autoUpdate = true;
    
    // Debug
    this.debugMode = false;
    
    console.log('[VolumeIntegration] Created');
  }
  
  /**
   * Initialize both systems
   */
  async init() {
    if (this.initialized) return;
    
    await this.volumeSystem.init();
    await this.volumeRenderer.init();
    
    // Connect renderer to system
    this.volumeRenderer.setVolumeData(this.volumeSystem);
    
    this.initialized = true;
    console.log('[VolumeIntegration] Initialized');
  }
  
  /**
   * Connect an existing particle system
   * The particle system should have: positionBuffer, metaBuffer, velocityBuffer, count
   * @param {string} id - Unique identifier
   * @param {Object} particleSystem - { positionBuffer, metaBuffer, velocityBuffer, count }
   */
  connectParticles(id, particleSystem) {
    const isNew = !this.connectedParticleSystems.has(id);
    this.connectedParticleSystems.set(id, particleSystem);
    if (isNew) {
      console.log(`[VolumeIntegration] Connected particle system: ${id}`);
    }
  }
  
  /**
   * Disconnect a particle system
   */
  disconnectParticles(id) {
    this.connectedParticleSystems.delete(id);
  }
  
  /**
   * Add a mesh to be rendered as volumetric particles
   * @param {string} id - Unique identifier
   * @param {Object} mesh - { vertexBuffer, colorBuffer, indexBuffer, vertexCount }
   */
  addMesh(id, mesh) {
    this.volumeSystem.addMeshBridge(id, mesh);
  }
  
  /**
   * Remove a mesh
   */
  removeMesh(id) {
    this.volumeSystem.removeMeshBridge(id);
  }
  
  /**
   * Set volume bounds
   * @param {number[]} min - [x, y, z]
   * @param {number[]} max - [x, y, z]
   */
  setVolumeBounds(min, max) {
    this.volumeSystem.setVolumeBounds(min, max);
    
    // Update renderer bounds
    this.volumeRenderer.volumeMin = min;
    this.volumeRenderer.volumeMax = max;
  }
  
  /**
   * Auto-fit volume bounds to particle positions
   * @param {number} padding - Extra space around particles
   */
  autoFitBounds(padding = 5) {
    // This would scan particle positions and set bounds
    // For now, use a reasonable default
    const halfSize = 25 + padding;
    this.setVolumeBounds(
      [-halfSize, -halfSize, -halfSize],
      [halfSize, halfSize, halfSize]
    );
  }
  
  /**
   * Set render mode
   * @param {number} mode - VolumeRenderMode value
   */
  setRenderMode(mode) {
    this.volumeSystem.setRenderMode(mode);
    this.volumeRenderer.setRenderMode(mode);
  }
  
  /**
   * Configure for smoke rendering
   */
  configureSmokeMode(options = {}) {
    this.setRenderMode(VolumeRenderMode.SMOKE);
    this.volumeRenderer.configureSmokeMode(options);
    
    if (options.densityScale !== undefined) {
      this.volumeSystem.setConfig({ densityScale: options.densityScale });
    }
  }
  
  /**
   * Configure for water rendering
   */
  configureWaterMode(options = {}) {
    this.setRenderMode(VolumeRenderMode.WATER);
    this.volumeRenderer.configureWaterMode(options);
  }
  
  /**
   * Enable debug density visualization
   */
  enableDebugMode() {
    this.debugMode = true;
    this.setRenderMode(VolumeRenderMode.DEBUG_DENSITY);
  }
  
  /**
   * Disable debug mode
   */
  disableDebugMode() {
    this.debugMode = false;
    this.setRenderMode(VolumeRenderMode.SMOKE);
  }
  
  /**
   * Update the volume system (call before render)
   * @param {GPUCommandEncoder} encoder
   * @param {Object} camera - { viewProj, invViewProj, position }
   */
  update(encoder, camera) {
    if (!this.initialized || !this.enabled) return;
    
    // Update particle data from connected systems
    for (const [id, ps] of this.connectedParticleSystems) {
      if (ps.positionBuffer && ps.count > 0) {
        this.volumeSystem.setParticleBuffers(
          ps.positionBuffer,
          ps.metaBuffer || ps.positionBuffer,
          ps.velocityBuffer || ps.positionBuffer,
          ps.count
        );
        break;  // Only use first connected system for now
      }
    }
    
    // Update grid (pass camera so bounds follow camera like Frostbite/UE froxels)
    if (this.autoUpdate) {
      this.volumeSystem.update(encoder, camera);
    }
    
    // Update renderer uniforms
    this.volumeRenderer.updateUniforms(camera);
    
    // Sync renderer bounds with system (they follow camera now)
    const bounds = this.volumeSystem.getVolumeBounds();
    this.volumeRenderer.volumeMin = bounds.min;
    this.volumeRenderer.volumeMax = bounds.max;
    
    // Refresh data bind group (in case buffers swapped)
    this.volumeRenderer.setVolumeData(this.volumeSystem);
  }
  
  /**
   * Set scene textures for compositing
   */
  setSceneTextures(colorTexture, depthTexture) {
    this.sceneColorTexture = colorTexture;
    this.sceneDepthTexture = depthTexture;
    
    if (this.initialized) {
      this.volumeRenderer.setSceneTextures(colorTexture, depthTexture);
    }
  }
  
  /**
   * Render the volume (call during render pass)
   * @param {GPURenderPassEncoder} pass
   * @param {GPUTexture} sceneColorTexture - Optional, for water refraction
   * @param {GPUTexture} sceneDepthTexture - For depth testing
   */
  render(pass, sceneColorTexture, sceneDepthTexture) {
    if (!this.initialized || !this.enabled) return;
    
    // Update scene textures if provided
    if (sceneColorTexture && sceneDepthTexture) {
      this.volumeRenderer.setSceneTextures(sceneColorTexture, sceneDepthTexture);
    }
    
    // Render volume
    this.volumeRenderer.render(pass);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      volumeSystem: this.volumeSystem.getStats(),
      connectedSystems: this.connectedParticleSystems.size,
      renderMode: this.volumeRenderer.renderMode,
      enabled: this.enabled,
    };
  }
  
  /**
   * Enable/disable the volume system
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  
  /**
   * Toggle enabled state
   */
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  
  /**
   * Resize
   */
  resize(width, height) {
    this.volumeRenderer.resize(width, height);
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.volumeSystem.destroy();
    this.volumeRenderer.destroy();
    this.connectedParticleSystems.clear();
    this.initialized = false;
  }
}

// Factory function for quick setup
export function createVolumeIntegration(device, options = {}) {
  return new VolumeIntegration(device, options);
}

export default VolumeIntegration;
