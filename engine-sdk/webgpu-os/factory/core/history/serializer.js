// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/serializer.js — stack serialize/restore for panel state.
 *
 * Only labels + timestamps round-trip (closures cannot be serialized). Panels
 * that want replayable history across session restores serialize their stack
 * labels alongside content; on restore they rebuild closures from content.
 */

export function serializeStack(stack) {
  return { strategy: stack.strategy, maxDepth: stack.maxDepth, entries: stack.list() };
}

/**
 * Restore label/timestamp metadata into a stack. Closures are not restored
 * (the panel rebuilds them from content); this is for UI display continuity.
 * @param {object} stack  UndoStack
 * @param {object} data   serialized form
 */
export function restoreStackMeta(stack, data) {
  stack.clear();
  for (const e of (data?.entries || [])) {
    // Restored entries are inert display markers (no-op undo/redo) until the
    // panel re-binds real closures.
    stack.push({ label: e.label, undo: () => {}, redo: () => {} });
  }
  return stack;
}
