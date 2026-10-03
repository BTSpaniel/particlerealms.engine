// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/index.js — the content-level history service.
 *
 * Per-panel isolated undo/redo stacks. Undoing in the text editor never affects
 * the canvas. Ctrl+Z is wired through shortcut scoping (panel scope only); the
 * session timeline restore is always a separate explicit UI action.
 *
 *   const history = ctx.services.get('history');
 *   history.push('panel.codeEditor', { label:'Delete line', undo, redo });
 *   history.undo('panel.codeEditor');
 */

import { createDeltaStack, DELTA_DEFAULT_DEPTH } from './delta.js';
import { createSnapshotStack, SNAPSHOT_DEFAULT_DEPTH, snapshotEntry } from './snapshot.js';
import { serializeStack, restoreStackMeta } from './serializer.js';
import { boundaryViolations } from './boundary.js';

export { UndoStack } from './stack.js';
export { createDeltaStack } from './delta.js';
export { createSnapshotStack, snapshotEntry } from './snapshot.js';
export { boundaryViolations, isContentSafe } from './boundary.js';
export { serializeStack, restoreStackMeta } from './serializer.js';

export class HistoryService {
  constructor() {
    this._stacks = new Map();   // panelId → UndoStack
    this._config = new Map();   // panelId → { strategy, maxDepth }
  }

  /**
   * Declare a panel's undo configuration (from its manifest.undo block).
   * @param {string} panelId
   * @param {{ strategy?:'delta'|'snapshot', maxDepth?:number }} [cfg]
   */
  configure(panelId, cfg = {}) {
    this._config.set(panelId, {
      strategy: cfg.strategy || 'delta',
      maxDepth: cfg.maxDepth || (cfg.strategy === 'snapshot' ? SNAPSHOT_DEFAULT_DEPTH : DELTA_DEFAULT_DEPTH),
    });
  }

  _stack(panelId) {
    let stack = this._stacks.get(panelId);
    if (!stack) {
      const cfg = this._config.get(panelId) || { strategy: 'delta' };
      stack = cfg.strategy === 'snapshot' ? createSnapshotStack(cfg.maxDepth) : createDeltaStack(cfg.maxDepth);
      this._stacks.set(panelId, stack);
    }
    return stack;
  }

  /** Push an undo entry for a panel. Entry payload is boundary-checked. */
  push(panelId, entry) {
    const violations = boundaryViolations(entry.payload);
    if (violations.length) throw new Error(`[history] ${violations[0]}`);
    this._stack(panelId).push(entry);
  }

  undo(panelId)    { return this._stack(panelId).undo(); }
  redo(panelId)    { return this._stack(panelId).redo(); }
  canUndo(panelId) { return this._stack(panelId).canUndo(); }
  canRedo(panelId) { return this._stack(panelId).canRedo(); }
  getStack(panelId) { return this._stack(panelId).list(); }

  /** Drop a panel's stack (on unmount, unless the panel serialized it). */
  dropStack(panelId) { this._stacks.delete(panelId); }

  serialize(panelId)        { return serializeStack(this._stack(panelId)); }
  restoreStack(panelId, data) { return restoreStackMeta(this._stack(panelId), data); }
}
