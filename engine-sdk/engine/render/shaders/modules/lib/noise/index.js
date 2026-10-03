// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Noise Library - Unified exports
 * 
 * Import everything from noise library:
 * import { hashWGSL, fbmWGSL, curlNoiseWGSL } from './lib/noise/index.js';
 */

export { hashWGSL } from './hash.js';
export { valueNoiseWGSL } from './value.js';
export { fbmWGSL } from './fbm.js';
export { curlNoiseWGSL } from './curl.js';

// Combined export for convenience - includes all noise functions
import { hashWGSL } from './hash.js';
import { valueNoiseWGSL } from './value.js';
import { fbmWGSL } from './fbm.js';
import { curlNoiseWGSL } from './curl.js';

function stripWGSLPrefix(source, prefix, label) {
  const index = source.indexOf(prefix);
  if (index !== -1) {
    return source.slice(0, index) + source.slice(index + prefix.length);
  }
  throw new Error(`Noise library chunk ${label} no longer contains its registered dependency prefix.`);
}



export const noiseLibWGSL =
  hashWGSL +
  stripWGSLPrefix(valueNoiseWGSL, hashWGSL, 'valueNoiseWGSL') +
  stripWGSLPrefix(fbmWGSL, valueNoiseWGSL, 'fbmWGSL') +
  stripWGSLPrefix(curlNoiseWGSL, valueNoiseWGSL, 'curlNoiseWGSL');
