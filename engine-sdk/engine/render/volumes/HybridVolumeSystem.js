// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HybridVolumeSystem.js - Unified Volumetric Rendering System
 * 
 * Combines particles, voxels, and meshes into a single volumetric representation.
 * Uses compute shaders to splat data to density grids, then raymarches for rendering.
 * 
 * Features:
 * - Particle → Density grid splatting
 * - Mesh vertex → Particle conversion
 * - Triple buffering for smooth updates
 * - Dirty region tracking (only update what changed)
 * - Multiple render modes: smoke, water, hybrid
 * 
 * Pipeline:
 * 1. Clear grid (compute)
 * 2. Splat particles to grid (compute)
 * 3. Finalize grid (compute) - convert atomics to floats
 * 4. Raymarch render (fragment)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { gridSplatComputeWGSL, gridClearComputeWGSL, gridFinalizeComputeWGSL } from '../shaders/modules/compute/grid_splat.js';

// Render modes
export const VolumeRenderMode = {
  SMOKE: 0,           // Volumetric smoke with absorption/scattering
  WATER: 1,           // Isosurface with refraction
  HYBRID: 2,          // Particles near, volume far
  PARTICLES_ONLY: 3,  // Just particles, no volume
  VOLUME_ONLY: 4,     // Just volume, no particles
  DEBUG_DENSITY: 5,   // Visualize density grid
};

// Default configuration
const DEFAULT_CONFIG = {
  gridResolution: 128,          // 128³ grid cells (higher res for large volume)
  volumeSize: 2000,             // 2km range - follows camera (Frostbite/UE froxel style)
  splatRadius: 8.0,             // Particle splat radius (larger for 2km volume, ~15m cells)
  densityScale: 1.0,            // Density multiplier
  colorBlend: 1.0,              // Color contribution
  tripleBuffer: true,           // Use triple buffering
  autoUpdate: true,             // Auto-update grid each frame
  renderMode: VolumeRenderMode.SMOKE,
};

export class HybridVolumeSystem {
  /**
   * @param {GPUDevice} device
   * @param {Object} options
   */
  constructor(device, options = {}) {
    this.device = device;
    this.vgpu = initVGPU(device);
    
    // Configuration
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.gridResolution = this.config.gridResolution;
    this.volumeSize = this.config.volumeSize;
    
    // Volume bounds (centered at origin by default)
    const halfSize = this.volumeSize * 0.5;
    this.volumeMin = options.volumeMin || [-halfSize, -halfSize, -halfSize];
    this.volumeMax = options.volumeMax || [halfSize, halfSize, halfSize];
    
    // Cell size
    this.cellSize = [
      (this.volumeMax[0] - this.volumeMin[0]) / this.gridResolution,
      (this.volumeMax[1] - this.volumeMin[1]) / this.gridResolution,
      (this.volumeMax[2] - this.volumeMin[2]) / this.gridResolution,
    ];
    
    // Grid buffers (triple-buffered for smooth updates)
    this.bufferCount = this.config.tripleBuffer ? 3 : 2;
    this.densityGrids = [];
    this.colorGridsR = [];
    this.colorGridsG = [];
    this.colorGridsB = [];
    this.colorGridsW = [];
    this.densityOutGrids = [];
    this.colorOutGrids = [];
    
    // Buffer indices
    this.readIndex = 0;
    this.writeIndex = 1;
    
    // Dirty tracking
    this.dirtyRegions = [];
    this.fullDirty = true;  // Start with full update
    
    // Pipelines
    this.clearPipeline = null;
    this.splatPipeline = null;
    this.finalizePipeline = null;
    
    // Uniform buffers
    this.splatParamsBuffer = null;
    this.clearParamsBuffer = null;
    this.finalizeParamsBuffer = null;
    
    // Particle data references
    this.particlePositions = null;
    this.particleMeta = null;
    this.particleVelocities = null;
    this.particleCount = 0;
    
    // Mesh-to-particle bridges
    this.meshParticleBridges = new Map();
    
    // State
    this.initialized = false;
    this.frameCount = 0;
    
    console.log('[HybridVolumeSystem] Created with config:', this.config);
  }
  
  /**
   * Initialize GPU resources
   */
  async init() {
    if (this.initialized) return;
    
    const totalCells = this.gridResolution ** 3;
    console.log(`[HybridVolumeSystem] Initializing ${this.gridResolution}³ grid (${totalCells} cells)`);
    
    // Create grid buffers (atomic u32 for compute, f32 for rendering)
    for (let i = 0; i < this.bufferCount; i++) {
      // Atomic buffers for compute splatting
      this.densityGrids.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `DensityGrid_${i}`
      }).buffer);
      
      this.colorGridsR.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `ColorGridR_${i}`
      }).buffer);
      
      this.colorGridsG.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `ColorGridG_${i}`
      }).buffer);
      
      this.colorGridsB.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `ColorGridB_${i}`
      }).buffer);
      
      this.colorGridsW.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `ColorGridW_${i}`
      }).buffer);
      
      // Output buffers for rendering (float)
      this.densityOutGrids.push(this.vgpu.buffer.create({
        size: totalCells * 4,
        usage: 'storage',
        label: `DensityOut_${i}`
      }).buffer);
      
      this.colorOutGrids.push(this.vgpu.buffer.create({
        size: totalCells * 16,  // vec4<f32>
        usage: 'storage',
        label: `ColorOut_${i}`
      }).buffer);
    }
    
    // Create uniform buffers
    this.splatParamsBuffer = this.vgpu.buffer.create({
      size: 64,  // SplatParams struct
      usage: 'uniform',
      label: 'SplatParams'
    }).buffer;
    
    this.clearParamsBuffer = this.vgpu.buffer.create({
      size: 16,  // ClearParams struct
      usage: 'uniform',
      label: 'ClearParams'
    }).buffer;
    
    this.finalizeParamsBuffer = this.vgpu.buffer.create({
      size: 16,  // FinalizeParams struct
      usage: 'uniform',
      label: 'FinalizeParams'
    }).buffer;
    
    // Create compute pipelines
    await this._createPipelines();
    
    // Write initial params
    this._updateClearParams();
    this._updateFinalizeParams();
    
    this.initialized = true;
    console.log('[HybridVolumeSystem] Initialized successfully');
  }
  
  async _createPipelines() {
    // Clear pipeline
    const clearModule = this.vgpu.shader.compile('gridClear', gridClearComputeWGSL);
    this.clearPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: clearModule,
        entryPoint: 'main'
      }
    });
    
    // Splat pipeline
    const splatModule = this.vgpu.shader.compile('gridSplat', gridSplatComputeWGSL);
    this.splatPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: splatModule,
        entryPoint: 'main'
      }
    });
    
    // Finalize pipeline
    const finalizeModule = this.vgpu.shader.compile('gridFinalize', gridFinalizeComputeWGSL);
    this.finalizePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: finalizeModule,
        entryPoint: 'main'
      }
    });
  }
  
  _updateClearParams() {
    const data = new Uint32Array([this.gridResolution, 0, 0, 0]);
    this.device.queue.writeBuffer(this.clearParamsBuffer, 0, data);
  }
  
  _updateFinalizeParams() {
    const data = new Float32Array([
      this.gridResolution,
      this.config.densityScale,
      this.config.colorBlend,
      0
    ]);
    // Convert first element to u32 for struct
    const view = new DataView(data.buffer);
    view.setUint32(0, this.gridResolution, true);
    this.device.queue.writeBuffer(this.finalizeParamsBuffer, 0, data);
  }
  
  _updateSplatParams() {
    const data = new Float32Array(16);
    
    // volumeMin
    data[0] = this.volumeMin[0];
    data[1] = this.volumeMin[1];
    data[2] = this.volumeMin[2];
    data[3] = this.gridResolution;  // gridResolution
    
    // volumeMax
    data[4] = this.volumeMax[0];
    data[5] = this.volumeMax[1];
    data[6] = this.volumeMax[2];
    // particleCount as u32
    const view = new DataView(data.buffer);
    view.setUint32(7 * 4, this.particleCount, true);
    
    // cellSize
    data[8] = this.cellSize[0];
    data[9] = this.cellSize[1];
    data[10] = this.cellSize[2];
    data[11] = this.config.splatRadius;  // splatRadius
    
    // Additional params
    data[12] = performance.now() * 0.001;  // time
    data[13] = this.config.densityScale;
    data[14] = this.config.colorBlend;
    data[15] = 0;
    
    this.device.queue.writeBuffer(this.splatParamsBuffer, 0, data);
  }
  
  /**
   * Set particle buffers for splatting
   * @param {GPUBuffer} positions - vec4<f32> positions
   * @param {GPUBuffer} meta - vec4<f32> metadata (color, size)
   * @param {GPUBuffer} velocities - vec4<f32> velocities
   * @param {number} count - Particle count
   */
  setParticleBuffers(positions, meta, velocities, count) {
    this.particlePositions = positions;
    this.particleMeta = meta;
    this.particleVelocities = velocities;
    this.particleCount = count;
    this.fullDirty = true;
  }
  
  /**
   * Bridge a mesh to use as particles
   * Mesh vertices become particle positions
   * @param {string} meshId - Unique identifier
   * @param {Object} mesh - { vertexBuffer, colorBuffer, indexBuffer, vertexCount }
   */
  addMeshBridge(meshId, mesh) {
    this.meshParticleBridges.set(meshId, {
      positions: mesh.vertexBuffer,
      colors: mesh.colorBuffer,
      indices: mesh.indexBuffer,
      count: mesh.vertexCount,
      active: true
    });
    this.fullDirty = true;
    console.log(`[HybridVolumeSystem] Added mesh bridge: ${meshId} (${mesh.vertexCount} vertices)`);
  }
  
  /**
   * Remove a mesh bridge
   */
  removeMeshBridge(meshId) {
    this.meshParticleBridges.delete(meshId);
    this.fullDirty = true;
  }
  
  /**
   * Mark a region as dirty (needs update)
   * @param {number[]} center - World position
   * @param {number} radius - Update radius
   */
  markDirty(center, radius) {
    this.dirtyRegions.push({ center, radius });
  }
  
  /**
   * Mark entire volume as dirty
   */
  markFullDirty() {
    this.fullDirty = true;
  }
  
  /**
   * Update volume bounds to follow camera (Frostbite/UE style froxel approach)
   * Centers volume around camera position with configurable range
   * @param {Object} camera - Camera with position array
   * @param {number} [range] - Optional override for volume range
   */
  updateBoundsFromCamera(camera) {
    if (!camera || !camera.position) return;
    
    const pos = camera.position;
    const halfSize = this.volumeSize * 0.5;
    
    // Center volume on camera position
    this.volumeMin = [
      pos[0] - halfSize,
      pos[1] - halfSize,
      pos[2] - halfSize
    ];
    this.volumeMax = [
      pos[0] + halfSize,
      pos[1] + halfSize,
      pos[2] + halfSize
    ];
    
    // Recalculate cell size
    this.cellSize = [
      (this.volumeMax[0] - this.volumeMin[0]) / this.gridResolution,
      (this.volumeMax[1] - this.volumeMin[1]) / this.gridResolution,
      (this.volumeMax[2] - this.volumeMin[2]) / this.gridResolution,
    ];
    
    this.fullDirty = true;
  }
  
  /**
   * Update the volume grid from particle data
   * @param {GPUCommandEncoder} encoder
   * @param {Object} [camera] - Optional camera to update bounds
   */
  update(encoder, camera) {
    // Update bounds to follow camera (like Frostbite/UE froxels)
    if (camera) {
      this.updateBoundsFromCamera(camera);
    }
    if (!this.initialized) return;
    if (!this.particlePositions || this.particleCount === 0) return;
    
    // Skip if nothing dirty and not auto-updating
    if (!this.fullDirty && this.dirtyRegions.length === 0 && !this.config.autoUpdate) {
      return;
    }
    
    this._updateSplatParams();
    
    // Clear grid
    this._clearGrid(encoder);
    
    // Splat particles
    this._splatParticles(encoder);
    
    // Splat mesh bridges
    for (const [meshId, bridge] of this.meshParticleBridges) {
      if (bridge.active) {
        this._splatMeshBridge(encoder, bridge);
      }
    }
    
    // Finalize (convert atomics to floats)
    this._finalizeGrid(encoder);
    
    // Swap buffers
    this._swapBuffers();
    
    // Clear dirty state
    this.fullDirty = false;
    this.dirtyRegions = [];
    this.frameCount++;
  }
  
  _clearGrid(encoder) {
    const writeIdx = this.writeIndex;
    const totalCells = this.gridResolution ** 3;
    
    const bindGroup = this.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.clearParamsBuffer } },
        { binding: 1, resource: { buffer: this.densityGrids[writeIdx] } },
        { binding: 2, resource: { buffer: this.colorGridsR[writeIdx] } },
        { binding: 3, resource: { buffer: this.colorGridsG[writeIdx] } },
        { binding: 4, resource: { buffer: this.colorGridsB[writeIdx] } },
        { binding: 5, resource: { buffer: this.colorGridsW[writeIdx] } },
      ]
    });
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.clearPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(totalCells / 64));
    pass.end();
  }
  
  _splatParticles(encoder) {
    if (!this.particlePositions || this.particleCount === 0) return;
    
    const writeIdx = this.writeIndex;
    
    const bindGroup = this.device.createBindGroup({
      layout: this.splatPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.splatParamsBuffer } },
        { binding: 1, resource: { buffer: this.particlePositions } },
        { binding: 2, resource: { buffer: this.particleMeta } },
        { binding: 3, resource: { buffer: this.particleVelocities } },
        { binding: 4, resource: { buffer: this.densityGrids[writeIdx] } },
        { binding: 5, resource: { buffer: this.colorGridsR[writeIdx] } },
        { binding: 6, resource: { buffer: this.colorGridsG[writeIdx] } },
        { binding: 7, resource: { buffer: this.colorGridsB[writeIdx] } },
        { binding: 8, resource: { buffer: this.colorGridsW[writeIdx] } },
      ]
    });
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.splatPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    pass.end();
  }
  
  _splatMeshBridge(encoder, bridge) {
    // Create temporary splat params for mesh
    const tempParams = this.vgpu.buffer.create({
      size: 64,
      usage: 'uniform',
      label: 'MeshSplatParams'
    }).buffer;
    
    const data = new Float32Array(16);
    data[0] = this.volumeMin[0];
    data[1] = this.volumeMin[1];
    data[2] = this.volumeMin[2];
    data[3] = this.gridResolution;
    data[4] = this.volumeMax[0];
    data[5] = this.volumeMax[1];
    data[6] = this.volumeMax[2];
    const view = new DataView(data.buffer);
    view.setUint32(7 * 4, bridge.count, true);
    data[8] = this.cellSize[0];
    data[9] = this.cellSize[1];
    data[10] = this.cellSize[2];
    data[11] = this.config.splatRadius * 0.5;  // Smaller for mesh vertices
    data[12] = performance.now() * 0.001;
    data[13] = this.config.densityScale;
    data[14] = this.config.colorBlend;
    data[15] = 0;
    
    this.device.queue.writeBuffer(tempParams, 0, data);
    
    const writeIdx = this.writeIndex;
    
    // Use positions as both position and velocity (or create dummy velocity)
    const velocityBuffer = bridge.velocities || bridge.positions;
    const metaBuffer = bridge.colors || bridge.positions;
    
    const bindGroup = this.device.createBindGroup({
      layout: this.splatPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tempParams } },
        { binding: 1, resource: { buffer: bridge.positions } },
        { binding: 2, resource: { buffer: metaBuffer } },
        { binding: 3, resource: { buffer: velocityBuffer } },
        { binding: 4, resource: { buffer: this.densityGrids[writeIdx] } },
        { binding: 5, resource: { buffer: this.colorGridsR[writeIdx] } },
        { binding: 6, resource: { buffer: this.colorGridsG[writeIdx] } },
        { binding: 7, resource: { buffer: this.colorGridsB[writeIdx] } },
        { binding: 8, resource: { buffer: this.colorGridsW[writeIdx] } },
      ]
    });
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.splatPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(bridge.count / 64));
    pass.end();
    
    // Cleanup temp buffer (will be garbage collected)
  }
  
  _finalizeGrid(encoder) {
    const writeIdx = this.writeIndex;
    const totalCells = this.gridResolution ** 3;
    
    const bindGroup = this.device.createBindGroup({
      layout: this.finalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.finalizeParamsBuffer } },
        { binding: 1, resource: { buffer: this.densityGrids[writeIdx] } },
        { binding: 2, resource: { buffer: this.colorGridsR[writeIdx] } },
        { binding: 3, resource: { buffer: this.colorGridsG[writeIdx] } },
        { binding: 4, resource: { buffer: this.colorGridsB[writeIdx] } },
        { binding: 5, resource: { buffer: this.colorGridsW[writeIdx] } },
        { binding: 6, resource: { buffer: this.densityOutGrids[writeIdx] } },
        { binding: 7, resource: { buffer: this.colorOutGrids[writeIdx] } },
      ]
    });
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.finalizePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(totalCells / 64));
    pass.end();
  }
  
  _swapBuffers() {
    if (this.bufferCount === 3) {
      // Triple buffer: read -> old, write -> read, old -> write
      const oldRead = this.readIndex;
      this.readIndex = this.writeIndex;
      this.writeIndex = (this.writeIndex + 1) % 3;
    } else {
      // Double buffer: just swap
      const temp = this.readIndex;
      this.readIndex = this.writeIndex;
      this.writeIndex = temp;
    }
  }
  
  /**
   * Get current density buffer for rendering
   */
  getDensityBuffer() {
    return this.densityOutGrids[this.readIndex];
  }
  
  /**
   * Get current color buffer for rendering
   */
  getColorBuffer() {
    return this.colorOutGrids[this.readIndex];
  }
  
  /**
   * Get volume bounds
   */
  getVolumeBounds() {
    return {
      min: this.volumeMin,
      max: this.volumeMax,
      resolution: this.gridResolution,
      cellSize: this.cellSize
    };
  }
  
  /**
   * Set volume bounds
   */
  setVolumeBounds(min, max) {
    this.volumeMin = min;
    this.volumeMax = max;
    this.cellSize = [
      (max[0] - min[0]) / this.gridResolution,
      (max[1] - min[1]) / this.gridResolution,
      (max[2] - min[2]) / this.gridResolution,
    ];
    this.fullDirty = true;
  }
  
  /**
   * Set render mode
   */
  setRenderMode(mode) {
    this.config.renderMode = mode;
  }
  
  /**
   * Get render mode
   */
  getRenderMode() {
    return this.config.renderMode;
  }
  
  /**
   * Update configuration
   */
  setConfig(newConfig) {
    Object.assign(this.config, newConfig);
    this._updateFinalizeParams();
    this.fullDirty = true;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      gridResolution: this.gridResolution,
      totalCells: this.gridResolution ** 3,
      particleCount: this.particleCount,
      meshBridges: this.meshParticleBridges.size,
      frameCount: this.frameCount,
      renderMode: this.config.renderMode,
      readIndex: this.readIndex,
      writeIndex: this.writeIndex,
    };
  }
  
  /**
   * Cleanup
   */
  destroy() {
    for (let i = 0; i < this.bufferCount; i++) {
      this.densityGrids[i]?.destroy();
      this.colorGridsR[i]?.destroy();
      this.colorGridsG[i]?.destroy();
      this.colorGridsB[i]?.destroy();
      this.colorGridsW[i]?.destroy();
      this.densityOutGrids[i]?.destroy();
      this.colorOutGrids[i]?.destroy();
    }
    
    this.splatParamsBuffer?.destroy();
    this.clearParamsBuffer?.destroy();
    this.finalizeParamsBuffer?.destroy();
    
    this.initialized = false;
    console.log('[HybridVolumeSystem] Destroyed');
  }
}

export default HybridVolumeSystem;
