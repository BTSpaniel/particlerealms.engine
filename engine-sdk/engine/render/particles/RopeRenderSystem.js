// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeRenderSystem.js - Integration layer for GPU rope rendering
 * 
 * Connects the RopeGPURenderer with the particle simulation world's
 * rope chain registry. Manages multiple ropes and batches rendering.
 */

import { createRopeGPURenderer } from "./RopeGPURenderer.js";

export class RopeRenderSystem {
  constructor(device, options = {}) {
    this.device = device;
    this.renderer = null;
    this.computeBindGroups = new Map(); // ropeId -> bindGroup
    this.ropeRenderers = new Map();
    this.initialized = false;
    this.options = {
      tubeSegments: options.tubeSegments || 8,
      tubeRadius: options.tubeRadius || 0.03,
      maxRopeParticles: options.maxRopeParticles || 2048,
      ...options,
    };
  }
  
  async initialize(colorFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
    if (this.initialized) return;
    
    this.renderer = createRopeGPURenderer(this.device, this.options);
    this.formats = [colorFormat, depthFormat];
    await this.renderer.initialize(colorFormat, depthFormat);
    this.initialized = true;
  }
  
  /**
   * Update rope bind groups based on particle world state
   * @param {Object} particleWorld - Particle simulation world
   */
  updateRopes(particleWorld) {
    if (!this.initialized || !particleWorld) return;
    
    const ropeChains = particleWorld.ropeChains || [];
    const positionBuffer = particleWorld.positionBuffer;
    
    if (!positionBuffer) return;
    if (this.positionBuffer !== positionBuffer || this.constraintBuffer !== particleWorld.ropeConstraintSystem?.constraintBuffer) {
      for (const renderer of this.ropeRenderers.values()) renderer.destroy();
      this.ropeRenderers.clear(); this.computeBindGroups.clear();
      this.positionBuffer = positionBuffer;
      this.constraintBuffer = particleWorld.ropeConstraintSystem?.constraintBuffer;
    }
    
    // Create/update bind groups for each rope
    const currentIds = new Set();
    
    for (const rope of ropeChains) {
      if (!rope || rope.entityId == null) continue;
      
      const id = rope.entityId;
      currentIds.add(id);
      
      if (!this.computeBindGroups.has(id)) {
        const renderer = createRopeGPURenderer(this.device, { ...this.options,
          maxRopeParticles: Math.max(this.options.maxRopeParticles, rope.particleCount) });
        renderer._initialize(...this.formats);
        this.ropeRenderers.set(id, renderer);
        const bindGroup = renderer.createComputeBindGroup(positionBuffer, particleWorld.ropeConstraintSystem?.constraintBuffer);
        this.computeBindGroups.set(id, bindGroup);
      }
    }
    
    // Remove stale bind groups
    for (const id of this.computeBindGroups.keys()) {
      if (!currentIds.has(id)) {
        this.computeBindGroups.delete(id);
        this.ropeRenderers.get(id)?.destroy(); this.ropeRenderers.delete(id);
      }
    }
  }
  
  /**
   * Generate tube meshes for all ropes
   * @param {GPUCommandEncoder} encoder
   * @param {Object} particleWorld - Particle simulation world
   */
  generateMeshes(encoder, particleWorld) {
    if (!this.initialized || !particleWorld) return;
    
    const ropeChains = particleWorld.ropeChains || [];
    
    for (const rope of ropeChains) {
      if (!rope || rope.entityId == null) continue;
      
      const bindGroup = this.computeBindGroups.get(rope.entityId);
      if (!bindGroup) continue;
      
      const particleStart = rope.particleStart || 0;
      const particleCount = rope.particleCount || 0;
      const tubeRadius = rope.radius || this.options.tubeRadius;
      
      if (particleCount < 2) continue;
      
      this.ropeRenderers.get(rope.entityId).generateMesh(encoder, bindGroup, {
        particleStart,
        particleCount,
        tubeRadius,
        constraintStart: particleWorld.ropeConstraintSystem ? rope.constraintStart : null,
      });
    }
  }
  
  /**
   * Render all rope meshes
   * @param {GPURenderPassEncoder} pass
   * @param {Object} camera - { viewProjection: Float32Array, position: [x,y,z] }
   */
  render(pass, camera) {
    if (!this.initialized) return;
    for (const renderer of this.ropeRenderers.values()) renderer.render(pass, camera);
  }
  
  /**
   * Full update cycle: update bind groups, generate meshes, prepare for render
   * @param {GPUCommandEncoder} encoder
   * @param {Object} particleWorld
   */
  update(encoder, particleWorld) {
    this.updateRopes(particleWorld);
    this.generateMeshes(encoder, particleWorld);
  }
  
  destroy() {
    for (const renderer of this.ropeRenderers.values()) renderer.destroy();
    this.ropeRenderers.clear();
    if (this.renderer) {
      this.renderer.destroy();
    }
    this.computeBindGroups.clear();
    this.initialized = false;
  }
}

/**
 * Create a rope render system
 * @param {GPUDevice} device
 * @param {Object} options
 * @returns {RopeRenderSystem}
 */
export function createRopeRenderSystem(device, options = {}) {
  return new RopeRenderSystem(device, options);
}

export default RopeRenderSystem;
