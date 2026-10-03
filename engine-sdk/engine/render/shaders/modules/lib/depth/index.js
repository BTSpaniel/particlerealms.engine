// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Depth Library - Unified exports
 */

export { depthLinearizeWGSL } from './linearize.js';
export { depthReconstructWGSL } from './reconstruct.js';

import { depthReconstructWGSL } from './reconstruct.js';

export const depthLibWGSL = depthReconstructWGSL;
