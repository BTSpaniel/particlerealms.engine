// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shader Library - Master Index
 * 
 * Universal modular shader chunk library for composing WGSL shaders.
 * 
 * Usage:
 * ```javascript
 * import { noiseLibWGSL, depthLibWGSL, lightingLibWGSL } from './lib/index.js';
 * const shader = noiseLibWGSL + depthLibWGSL + myVertexShader + myFragmentShader;
 * ```
 * 
 * Or import individual chunks:
 * ```javascript
 * import { fbmWGSL, curlNoiseWGSL } from './lib/noise/index.js';
 * import { depthLinearizeWGSL } from './lib/depth/index.js';
 * ```
 */

// Re-export all libraries
export * from './noise/index.js';
export * from './depth/index.js';
export * from './density/index.js';
export * from './lighting/index.js';
export * from './color/index.js';
export * from './distortion/index.js';
export * from './math/index.js';

// Combined full library (use sparingly - only import what you need)
import { noiseLibWGSL } from './noise/index.js';

import { fbmWGSL } from './noise/fbm.js';
import { depthLibWGSL } from './depth/index.js';
import { densityLibWGSL } from './density/index.js';
import { lightingLibWGSL } from './lighting/index.js';
import { colorLibWGSL } from './color/index.js';
import { distortionLibWGSL } from './distortion/index.js';
import { mathLibWGSL } from './math/index.js';

function stripWGSLPrefix(source, prefix, label) {
  const index = source.indexOf(prefix);
  if (index !== -1) {
    return source.slice(0, index) + source.slice(index + prefix.length);
  }
  throw new Error(`Shader library chunk ${label} no longer contains its registered dependency prefix.`);
}



export const fullShaderLibWGSL =
  noiseLibWGSL + 
  depthLibWGSL + 
  densityLibWGSL + 
  lightingLibWGSL + 
  colorLibWGSL + 
  stripWGSLPrefix(distortionLibWGSL, fbmWGSL, 'distortionLibWGSL') +
  mathLibWGSL;
