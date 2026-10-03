// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleVolumeConnector.js - Bridge between Particle Renderers and Volume System
 * 
 * Automatically extracts GPU buffers from existing particle renderers
 * and feeds them to the HybridVolumeSystem for volumetric rendering.
 * 
 * Supports:
 * - ParticleBillboardRenderer
 * - ParticleSdfRenderer
 * - ParticleEmissiveRenderer
 * - Any renderer with positionBuffer, metaBuffer, velocityBuffer
 */

import { VolumeIntegration, VolumeRenderMode } from './VolumeIntegration.js';

export class ParticleVolumeConnector {
  /**
   * @param {GPUDevice} device
   * @param {Object} options
   */
  constructor(device, options = {}) {
    this.device = device;
    this.volumeIntegration = null;
    
    // Connected renderers
    this.particleRenderers = new Map();
    
    // Configuration
    this.format = options.format || 'bgra8unorm';
    this.width = options.width || 1920;
    this.height = options.height || 1080;
    this.gridResolution = options.gridResolution || 64;
    this.volumeSize = options.volumeSize || 50;
    
    // State
    this.initialized = false;
    this.enabled = true;
    
    // Auto-detect buffer names
    this.bufferNames = {
      positions: ['positionBuffer', 'positions', 'uPositions', 'posBuffer'],
      meta: ['metaBuffer', 'meta', 'uMeta', 'colorBuffer', 'colors'],
      velocities: ['velocityBuffer', 'velocities', 'uVelocities', 'velBuffer'],
      count: ['particleCount', 'count', 'numParticles', 'activeCount']
    };
    
    console.log('[ParticleVolumeConnector] Created');
  }
  
  /**
   * Initialize the volume system
   */
  async init() {
    if (this.initialized) return;
    
    this.volumeIntegration = new VolumeIntegration(this.device, {
      format: this.format,
      width: this.width,
      height: this.height,
      gridResolution: this.gridResolution,
      volumeSize: this.volumeSize,
    });
    
    await this.volumeIntegration.init();
    
    this.initialized = true;
    console.log('[ParticleVolumeConnector] Initialized');
  }
  
  /**
   * Connect a particle renderer
   * Automatically detects buffer names
   * @param {string} id - Unique identifier
   * @param {Object} renderer - Particle renderer instance
   */
  connectRenderer(id, renderer) {
    const connection = {
      renderer,
      positionBuffer: null,
      metaBuffer: null,
      velocityBuffer: null,
      countGetter: null,
    };
    
    // Auto-detect position buffer
    for (const name of this.bufferNames.positions) {
      if (renderer[name]) {
        connection.positionBuffer = () => renderer[name];
        break;
      }
    }
    
    // Auto-detect meta/color buffer
    for (const name of this.bufferNames.meta) {
      if (renderer[name]) {
        connection.metaBuffer = () => renderer[name];
        break;
      }
    }
    
    // Auto-detect velocity buffer
    for (const name of this.bufferNames.velocities) {
      if (renderer[name]) {
        connection.velocityBuffer = () => renderer[name];
        break;
      }
    }
    
    // Auto-detect count
    for (const name of this.bufferNames.count) {
      if (typeof renderer[name] === 'number') {
        connection.countGetter = () => renderer[name];
        break;
      } else if (typeof renderer[name] === 'function') {
        connection.countGetter = () => renderer[name]();
        break;
      }
    }
    
    // Fallback: try to access via methods
    if (!connection.positionBuffer && renderer.getPositionBuffer) {
      connection.positionBuffer = () => renderer.getPositionBuffer();
    }
    if (!connection.metaBuffer && renderer.getMetaBuffer) {
      connection.metaBuffer = () => renderer.getMetaBuffer();
    }
    if (!connection.velocityBuffer && renderer.getVelocityBuffer) {
      connection.velocityBuffer = () => renderer.getVelocityBuffer();
    }
    if (!connection.countGetter && renderer.getParticleCount) {
      connection.countGetter = () => renderer.getParticleCount();
    }
    
    // Store connection
    this.particleRenderers.set(id, connection);
    
    console.log(`[ParticleVolumeConnector] Connected renderer: ${id}`, {
      hasPositions: !!connection.positionBuffer,
      hasMeta: !!connection.metaBuffer,
      hasVelocities: !!connection.velocityBuffer,
      hasCount: !!connection.countGetter,
    });
  }
  
  /**
   * Manually set buffer accessors for a renderer
   */
  setRendererBuffers(id, buffers) {
    const connection = this.particleRenderers.get(id);
    if (!connection) {
      console.warn(`[ParticleVolumeConnector] Renderer ${id} not found`);
      return;
    }
    
    if (buffers.positionBuffer) {
      connection.positionBuffer = typeof buffers.positionBuffer === 'function' 
        ? buffers.positionBuffer 
        : () => buffers.positionBuffer;
    }
    if (buffers.metaBuffer) {
      connection.metaBuffer = typeof buffers.metaBuffer === 'function'
        ? buffers.metaBuffer
        : () => buffers.metaBuffer;
    }
    if (buffers.velocityBuffer) {
      connection.velocityBuffer = typeof buffers.velocityBuffer === 'function'
        ? buffers.velocityBuffer
        : () => buffers.velocityBuffer;
    }
    if (buffers.count !== undefined) {
      connection.countGetter = typeof buffers.count === 'function'
        ? buffers.count
        : () => buffers.count;
    }
  }
  
  /**
   * Disconnect a renderer
   */
  disconnectRenderer(id) {
    this.particleRenderers.delete(id);
    if (this.volumeIntegration) {
      this.volumeIntegration.disconnectParticles(id);
    }
  }
  
  /**
   * Update the volume system with current particle data
   * @param {GPUCommandEncoder} encoder
   * @param {Object} camera
   */
  update(encoder, camera) {
    if (!this.initialized || !this.enabled) return;
    
    // Gather particle data from connected renderers
    for (const [id, connection] of this.particleRenderers) {
      try {
        const posBuffer = connection.positionBuffer?.();
        const metaBuffer = connection.metaBuffer?.();
        const velBuffer = connection.velocityBuffer?.();
        const count = connection.countGetter?.() || 0;
        
        if (posBuffer && count > 0) {
          // Connect to volume integration
          this.volumeIntegration.connectParticles(id, {
            positionBuffer: posBuffer,
            metaBuffer: metaBuffer || posBuffer,
            velocityBuffer: velBuffer || posBuffer,
            count: count,
          });
        }
      } catch (err) {
        console.warn(`[ParticleVolumeConnector] Error getting buffers from ${id}:`, err);
      }
    }
    
    // Update volume system
    this.volumeIntegration.update(encoder, camera);
  }
  
  /**
   * Set scene textures for compositing
   */
  setSceneTextures(colorTexture, depthTexture) {
    if (this.volumeIntegration) {
      this.volumeIntegration.setSceneTextures(colorTexture, depthTexture);
    }
  }
  
  /**
   * Render the volume
   */
  render(pass, sceneColorTexture, sceneDepthTexture) {
    if (!this.initialized || !this.enabled) return;
    this.volumeIntegration.render(pass, sceneColorTexture, sceneDepthTexture);
  }
  
  /**
   * Set render mode
   */
  setRenderMode(mode) {
    if (this.volumeIntegration) {
      this.volumeIntegration.setRenderMode(mode);
    }
  }
  
  /**
   * Configure for smoke
   */
  configureSmokeMode(options = {}) {
    if (this.volumeIntegration) {
      this.volumeIntegration.configureSmokeMode(options);
    }
  }
  
  /**
   * Configure for water
   */
  configureWaterMode(options = {}) {
    if (this.volumeIntegration) {
      this.volumeIntegration.configureWaterMode(options);
    }
  }
  
  /**
   * Set volume bounds
   */
  setVolumeBounds(min, max) {
    if (this.volumeIntegration) {
      this.volumeIntegration.setVolumeBounds(min, max);
    }
  }
  
  /**
   * Enable/disable
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.volumeIntegration) {
      this.volumeIntegration.setEnabled(enabled);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      connectedRenderers: this.particleRenderers.size,
      volumeStats: this.volumeIntegration?.getStats(),
      enabled: this.enabled,
    };
  }
  
  /**
   * Resize
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.volumeIntegration) {
      this.volumeIntegration.resize(width, height);
    }
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.particleRenderers.clear();
    if (this.volumeIntegration) {
      this.volumeIntegration.destroy();
    }
    this.initialized = false;
  }
}

/**
 * Quick factory to create a connector and initialize it
 */
export async function createParticleVolumeConnector(device, options = {}) {
  const connector = new ParticleVolumeConnector(device, options);
  await connector.init();
  return connector;
}

export default ParticleVolumeConnector;
