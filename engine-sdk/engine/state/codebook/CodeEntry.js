// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/codebook/CodeEntry.js — the layered code packet. NOT one magic number:
// each field has exactly one job and never pretends to be another.
//
//   denseID        fast runtime handle
//   exactID        literal pattern identity (9-bit packed / canonical)
//   spatialID      where it belongs in space   (filled by the spatial layer, M2)
//   resonanceVector what it resembles          (filled by the resonance layer, M3)
//   correctionCode how to repair corruption    (filled by the correction layer, M5)
//   hashID         have we seen this exact thing
//   symbolicSig    what it MEANS (optional)

import { canonicalId, patternHashId } from './PatternCodebook.js';
import { urcVersionStamp } from '../version.js';

/**
 * Build a CodeEntry for a raw 3x3 pattern. Later layers enrich the null fields:
 * spatialID (M2 SpatialCode), resonanceVector (M3 Transforms), correctionCode
 * (M5 CorrectionGate). Keeping them explicitly null preserves the layer law —
 * a missing layer is visibly missing, never faked.
 *
 * @param {number} rawId            packed 9-bit pattern
 * @param {object} [opts]
 * @param {import('./PatternCodebook.js').PatternCodebook} [opts.codebook]
 * @param {object} [opts.symbolicSig]  result of SymbolicSig.symbolicSig(...)
 * @returns {Readonly<object>} CodeEntry
 */
export function makeCodeEntry(rawId, opts = {}) {
  const exact = canonicalId(rawId);
  const dense = opts.codebook ? opts.codebook.denseId(rawId) : exact;
  return Object.freeze({
    denseID: dense,
    exactID: exact,
    spatialID: opts.spatialID ?? null,        // M2
    resonanceVector: opts.resonanceVector ?? null, // M3
    correctionCode: opts.correctionCode ?? null,    // M5
    hashID: patternHashId(rawId),
    symbolicSig: opts.symbolicSig ?? null,
    version: urcVersionStamp(),
  });
}
