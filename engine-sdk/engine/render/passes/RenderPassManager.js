// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Render Pass Manager
 * 
 * Manages multi-pass rendering pipeline with pass selection and visualization.
 * Handles render target allocation, pass execution, and debug visualization.
 */

export class RenderPassManager {
  constructor(device) {
    this.device = device;
    this.passes = new Map();
    this.renderTargets = new Map();
    this.activeViewMode = 'final'; // 'final', 'depth', 'normals', etc.
    this.passOrder = [];
  }
  
  /**
   * Register a render pass
   * @param {Object} config
   * @param {string} config.name - Pass name (e.g., 'depth', 'composite')
   * @param {string[]} config.inputs - Input render target names
   * @param {string[]} config.outputs - Output render target names
   * @param {Function} config.execute - Execute function (device, encoder, inputs, outputs) => void
   * @param {Object} config.outputFormats - Format specs for outputs { name: { format, width, height } }
   */
  registerPass(config) {
    const { name, inputs = [], outputs = [], execute, outputFormats = {} } = config;
    
    this.passes.set(name, {
      name,
      inputs,
      outputs,
      execute,
      outputFormats,
      enabled: true
    });
    
    // Allocate render targets for outputs
    for (const outputName of outputs) {
      if (!this.renderTargets.has(outputName) && outputFormats[outputName]) {
        this.allocateRenderTarget(outputName, outputFormats[outputName]);
      }
    }
    
    // Rebuild pass execution order
    this.buildPassOrder();
  }
  
  /**
   * Allocate a render target texture
   */
  allocateRenderTarget(name, spec) {
    const { format, width, height, usage = 'render-attachment|texture-binding' } = spec;
    
    const texture = this.device.createTexture({
      size: [width, height, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: `RenderTarget_${name}`
    });
    
    const view = texture.createView();
    
    this.renderTargets.set(name, { texture, view, format, width, height });
  }
  
  /**
   * Resize render targets (call on viewport resize)
   */
  resizeRenderTargets(width, height) {
    for (const [name, rt] of this.renderTargets.entries()) {
      // Find the pass that creates this target to get format
      let format = rt.format;
      
      // Destroy old texture
      rt.texture.destroy();
      
      // Create new texture
      const texture = this.device.createTexture({
        size: [width, height, 1],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: `RenderTarget_${name}`
      });
      
      const view = texture.createView();
      
      this.renderTargets.set(name, { texture, view, format, width, height });
    }
  }
  
  /**
   * Build pass execution order based on dependencies
   */
  buildPassOrder() {
    const order = [];
    const visited = new Set();
    const visiting = new Set();
    
    const visit = (passName) => {
      if (visited.has(passName)) return;
      if (visiting.has(passName)) {
        throw new Error(`Circular dependency in pass graph: ${passName}`);
      }
      
      const pass = this.passes.get(passName);
      if (!pass) return;
      
      visiting.add(passName);
      
      // Visit all passes that produce our inputs
      for (const input of pass.inputs) {
        for (const [name, p] of this.passes.entries()) {
          if (p.outputs.includes(input)) {
            visit(name);
          }
        }
      }
      
      visiting.delete(passName);
      visited.add(passName);
      order.push(passName);
    };
    
    // Visit all passes
    for (const passName of this.passes.keys()) {
      visit(passName);
    }
    
    this.passOrder = order;
  }
  
  /**
   * Execute all passes in dependency order
   * @param {GPUCommandEncoder} encoder
   * @param {Object} context - Shared context (camera, scene, etc.)
   */
  execute(encoder, context) {
    for (const passName of this.passOrder) {
      const pass = this.passes.get(passName);
      if (!pass || !pass.enabled) continue;
      
      // Gather input render targets
      const inputs = {};
      for (const inputName of pass.inputs) {
        const rt = this.renderTargets.get(inputName);
        if (rt) inputs[inputName] = rt;
      }
      
      // Gather output render targets
      const outputs = {};
      for (const outputName of pass.outputs) {
        const rt = this.renderTargets.get(outputName);
        if (rt) outputs[outputName] = rt;
      }
      
      // Execute pass
      pass.execute(this.device, encoder, inputs, outputs, context);
    }
  }
  
  /**
   * Set active view mode for visualization
   * @param {string} mode - 'final', 'depth', 'normals', etc.
   */
  setViewMode(mode) {
    this.activeViewMode = mode;
  }
  
  /**
   * Get current view mode
   */
  getViewMode() {
    return this.activeViewMode;
  }
  
  /**
   * Get render target for current view mode
   */
  getViewModeRenderTarget() {
    // Map view modes to render target names
    const targetMap = {
      'depth': 'depthPrepass',
      'normals': 'normalBuffer',
      'final': 'finalColor'
    };
    
    const targetName = targetMap[this.activeViewMode];
    return targetName ? this.renderTargets.get(targetName) : null;
  }
  
  /**
   * Get available view modes
   */
  getAvailableViewModes() {
    const modes = ['final'];
    
    // Add modes based on registered passes
    if (this.renderTargets.has('depthPrepass')) modes.push('depth');
    if (this.renderTargets.has('normalBuffer')) modes.push('normals');
    if (this.renderTargets.has('albedo')) modes.push('albedo');
    if (this.renderTargets.has('lighting')) modes.push('lighting');
    
    return modes;
  }
  
  /**
   * Enable/disable a pass
   */
  setPassEnabled(passName, enabled) {
    const pass = this.passes.get(passName);
    if (pass) pass.enabled = enabled;
  }
  
  /**
   * Destroy all render targets
   */
  destroy() {
    for (const rt of this.renderTargets.values()) {
      rt.texture.destroy();
    }
    this.renderTargets.clear();
    this.passes.clear();
  }
}
