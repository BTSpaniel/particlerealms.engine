// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shader Composer - Modular Shader Assembly System
 * 
 * Composes WGSL shaders from reusable library chunks.
 * Supports multi-pass rendering with automatic dependency resolution.
 * 
 * Usage:
 * ```javascript
 * const shader = ShaderComposer.compose({
 *   libs: ['noise/fbm', 'depth/linearize', 'lighting/scatter'],
 *   vertex: myVertexWGSL,
 *   fragment: myFragmentWGSL
 * });
 * ```
 */

import { hashWGSL } from './modules/lib/noise/hash.js';
import { valueNoiseWGSL } from './modules/lib/noise/value.js';
import { fbmWGSL } from './modules/lib/noise/fbm.js';
import { curlNoiseWGSL } from './modules/lib/noise/curl.js';
import { depthLinearizeWGSL } from './modules/lib/depth/linearize.js';
import { depthReconstructWGSL } from './modules/lib/depth/reconstruct.js';
import { densityFalloffWGSL } from './modules/lib/density/falloff.js';
import { lightScatterWGSL } from './modules/lib/lighting/scatter.js';
import { colorBlendWGSL } from './modules/lib/color/blend.js';
import { domainWarpWGSL } from './modules/lib/distortion/domain_warp.js';
import { interpolationWGSL } from './modules/lib/math/interpolation.js';
import { sdfShapesLibrary } from './modules/lib/sdf/shapes.js';
import { noise3dLibrary } from './modules/lib/noise/noise3d.js';
import { phaseVFXWGSL } from './modules/core/particles_phase_vfx.js';

const LIBRARY_MAP = {
  // Noise
  'noise/hash': hashWGSL,
  'noise/value': valueNoiseWGSL,
  'noise/fbm': fbmWGSL,
  'noise/curl': curlNoiseWGSL,
  'noise/noise3d': noise3dLibrary,
  
  // Depth
  'depth/linearize': depthLinearizeWGSL,
  'depth/reconstruct': depthReconstructWGSL,
  
  // Density
  'density/falloff': densityFalloffWGSL,
  
  // Lighting
  'lighting/scatter': lightScatterWGSL,
  
  // Color
  'color/blend': colorBlendWGSL,
  
  // Distortion
  'distortion/warp': domainWarpWGSL,
  
  // SDF Shapes
  'sdf/shapes': sdfShapesLibrary,
  
  // Math
  'math/interpolation': interpolationWGSL,
  
  // Particles
  'particles/phase_vfx': phaseVFXWGSL,
};

// Dependency graph - libs that depend on others
const DEPENDENCIES = {
  'noise/value': ['noise/hash'],
  'noise/fbm': ['noise/value'],
  'noise/curl': ['noise/value'],
  'depth/reconstruct': ['depth/linearize'],
  'distortion/warp': ['noise/fbm'],
};

export class ShaderComposer {
  /**
   * Compose a shader from library chunks
   * @param {Object} config
   * @param {string[]} config.libs - Library chunks to include (e.g., ['noise/fbm', 'depth/linearize'])
   * @param {string} config.vertex - Vertex shader WGSL code
   * @param {string} config.fragment - Fragment shader WGSL code
   * @param {string} config.compute - Compute shader WGSL code (alternative to vertex/fragment)
   * @returns {string} Complete WGSL shader code
   */
  static compose(config) {
    const { libs = [], vertex = '', fragment = '', compute = '' } = config;
    
    // Resolve dependencies
    const resolvedLibs = this.resolveDependencies(libs);
    
    // Build shader from chunks
    const libraryCode = resolvedLibs
      .map(lib => LIBRARY_MAP[lib])
      .filter(Boolean)
      .join('\n\n');
    
    if (compute) {
      return libraryCode + '\n\n' + compute;
    }
    
    return libraryCode + '\n\n' + vertex + '\n\n' + fragment;
  }
  
  /**
   * Resolve library dependencies in correct order
   * @param {string[]} libs - Requested libraries
   * @returns {string[]} Libraries with dependencies in topological order
   */
  static resolveDependencies(libs) {
    const resolved = new Set();
    const visiting = new Set();
    
    const visit = (lib) => {
      if (resolved.has(lib)) return;
      if (visiting.has(lib)) {
        throw new Error(`Circular dependency detected: ${lib}`);
      }
      
      visiting.add(lib);
      
      // Visit dependencies first
      const deps = DEPENDENCIES[lib] || [];
      for (const dep of deps) {
        visit(dep);
      }
      
      visiting.delete(lib);
      resolved.add(lib);
    };
    
    // Visit all requested libs
    for (const lib of libs) {
      visit(lib);
    }
    
    return Array.from(resolved);
  }
  
  /**
   * Create a multi-pass shader configuration
   * @param {Object} config
   * @param {Object[]} config.passes - Array of pass configurations
   * @returns {Object} Multi-pass shader configuration
   */
  static composeMultiPass(config) {
    const { passes } = config;
    
    return passes.map(pass => {
      const { name, libs, vertex, fragment, compute, outputs, inputs } = pass;
      
      return {
        name,
        shader: this.compose({ libs, vertex, fragment, compute }),
        outputs: outputs || [],
        inputs: inputs || [],
      };
    });
  }
  
  /**
   * Get available library chunks
   * @returns {string[]} List of available library paths
   */
  static getAvailableLibraries() {
    return Object.keys(LIBRARY_MAP);
  }
  
  /**
   * Validate library path
   * @param {string} lib - Library path
   * @returns {boolean} True if library exists
   */
  static hasLibrary(lib) {
    return lib in LIBRARY_MAP;
  }
}

export default ShaderComposer;
