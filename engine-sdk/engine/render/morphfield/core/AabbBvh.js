// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AabbBvh as SharedAabbBvh } from '../../../core/math/AabbBvh.js';
import { failMorphField } from './errors.js';
import { normalizeBounds } from './validation.js';

/** MorphField keeps its original strict volume bounds and domain errors. */
export class AabbBvh extends SharedAabbBvh {
  constructor(leaves = []) { super(leaves, { normalize: normalizeBounds, fail: failMorphField }); }
}
export function buildAabbBvh(leaves) { return new AabbBvh(leaves); }
