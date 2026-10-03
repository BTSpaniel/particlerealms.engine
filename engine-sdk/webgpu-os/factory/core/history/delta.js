// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/delta.js — delta strategy.
 *
 * Stores only what changed (the undo/redo closures the panel supplies). Fast
 * and memory-efficient — the default for text editors, node graphs, and
 * command sequences. Default depth: 200.
 */

import { UndoStack } from './stack.js';

export const DELTA_DEFAULT_DEPTH = 200;

export function createDeltaStack(maxDepth = DELTA_DEFAULT_DEPTH) {
  return new UndoStack({ maxDepth, strategy: 'delta' });
}
