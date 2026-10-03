// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/stack.js — per-panel undo/redo stack.
 *
 * Each entry carries a label plus undo/redo closures. Pushing a new entry
 * clears the redo stack. Depth is bounded by the strategy's maxDepth.
 */

export class UndoStack {
  /** @param {{ maxDepth?:number, strategy?:string }} [opts] */
  constructor(opts = {}) {
    this.maxDepth = opts.maxDepth || 200;
    this.strategy = opts.strategy || 'delta';
    this._undo = [];
    this._redo = [];
  }

  /** @param {{ label:string, undo:Function, redo:Function }} entry */
  push(entry) {
    if (typeof entry.undo !== 'function' || typeof entry.redo !== 'function') {
      throw new Error('[history] entry requires undo() and redo() functions');
    }
    this._undo.push({ label: entry.label || '', undo: entry.undo, redo: entry.redo, timestamp: Date.now() });
    while (this._undo.length > this.maxDepth) this._undo.shift();
    this._redo = [];
  }

  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }

  undo() {
    if (!this.canUndo()) return null;
    const entry = this._undo.pop();
    try { entry.undo(); } catch (err) { this._undo.push(entry); console.warn('[history] undo rejected:', err); throw err; }
    this._redo.push(entry);
    return entry;
  }

  redo() {
    if (!this.canRedo()) return null;
    const entry = this._redo.pop();
    try { entry.redo(); } catch (err) { this._redo.push(entry); console.warn('[history] redo rejected:', err); throw err; }
    this._undo.push(entry);
    return entry;
  }

  /** Stack labels + timestamps (no closures) for UI / serialization. */
  list() { return this._undo.map((e) => ({ label: e.label, timestamp: e.timestamp })); }

  clear() { this._undo = []; this._redo = []; }
}
