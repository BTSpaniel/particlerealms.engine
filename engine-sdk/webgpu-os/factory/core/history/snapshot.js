// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/snapshot.js — snapshot strategy.
 *
 * Stores full content state per step; used when deltas are too complex
 * (canvas, timeline, spatial editors). Heavier, so a smaller default depth: 20.
 */

import { UndoStack } from './stack.js';

export const SNAPSHOT_DEFAULT_DEPTH = 20;

export function createSnapshotStack(maxDepth = SNAPSHOT_DEFAULT_DEPTH) {
  return new UndoStack({ maxDepth, strategy: 'snapshot' });
}

/**
 * Helper to build an undo/redo entry from before/after full-state snapshots and
 * an apply(state) function.
 * @param {string} label
 * @param {*} before
 * @param {*} after
 * @param {(state:any)=>void} apply
 */
export function snapshotEntry(label, before, after, apply) {
  return { label, undo: () => apply(before), redo: () => apply(after) };
}
