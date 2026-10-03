// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { HistoryService, snapshotEntry } from '../../core/history/index.js';

let transactionSequence = 0;

/** One continuous gesture becomes one existing Factory history entry. State setters are synchronous. */
export function createEditTransaction({ getState, applyState, history = null, validate = null, onEvent = null, getRevision = null, signal = null } = {}) {
  if (typeof getState !== 'function' || typeof applyState !== 'function') throw new TypeError('Transactions require state getter and synchronous setter');
  const scope = `drawing.transaction.${++transactionSequence}`, service = history ? null : new HistoryService();
  const stack = history ?? { push: entry => service.push(scope, entry), undo: () => service.undo(scope), redo: () => service.redo(scope) };
  let active = null, destroyed = false, sequence = 0;
  const copy = value => structuredClone(value);
  const emit = event => { try { onEvent?.(event); } catch (error) { console.warn('[Factory][editTransaction][observer]', error); } };
  const checked = value => { const next = copy(value); if (validate?.(next)?.then) throw new TypeError('Transaction validation must be synchronous'); return next; };
  function publish(value, phase, label, changed = true) {
    if (destroyed) return;
    const result = applyState(copy(value), { phase, label, changed });
    if (result?.then) throw new TypeError('Transaction applyState must be synchronous');
    emit({ phase, label });
  }
  function assertCurrent() {
    if (destroyed) throw new DOMException('Transaction controller closed', 'AbortError');
    if (!active) throw new Error('Begin an edit before preview or commit');
    if (getRevision && getRevision() !== active.revision) {
      const prior = active; active = null; emit({ phase: 'conflict', label: prior.label });
      throw new Error('The document revision changed during this edit');
    }
  }
  function begin(label = 'Edit', { expectedRevision = getRevision?.() } = {}) {
    if (destroyed) throw new DOMException('Transaction controller closed', 'AbortError');
    if (active) throw new Error('Finish or cancel the current edit first');
    if (getRevision && getRevision() !== expectedRevision) throw new Error('The document revision changed before this edit');
    const before = checked(getState());
    active = { id: ++sequence, label, before, next: copy(before), revision: expectedRevision };
    emit({ phase: 'begin', id: active.id, label }); return active.id;
  }
  function preview(value) {
    assertCurrent();
    const next = checked(typeof value === 'function' ? value(copy(active.before)) : value);
    publish(next, 'preview', active.label); active.next = copy(next); return copy(next);
  }
  function commit(value) {
    assertCurrent(); if (value !== undefined) preview(value);
    const edit = active, after = checked(edit.next);
    const changed = JSON.stringify(edit.before) !== JSON.stringify(after);
    // Commit notification may advance the caller's revision; guard has already run.
    publish(after, 'commit', edit.label, changed); active = null;
    if (changed) stack.push(snapshotEntry(edit.label, copy(edit.before), copy(after), state => publish(state, 'restore', edit.label)));
    console.debug('[Factory][editTransaction][commit]', { label: edit.label, changed });
    return { changed, state: copy(after) };
  }
  function cancel() {
    if (!active) return false;
    const edit = active; active = null;
    if (!getRevision || getRevision() === edit.revision) publish(edit.before, 'cancel', edit.label);
    else emit({ phase: 'conflict', label: edit.label });
    return true;
  }
  function destroy() { if (destroyed) return; cancel(); destroyed = true; signal?.removeEventListener('abort', destroy); service?.dropStack(scope); }
  if (signal?.aborted) destroy(); else signal?.addEventListener('abort', destroy, { once: true });
  return { begin, preview, commit, cancel, destroy, getActive: () => active ? { id: active.id, label: active.label } : null,
    undo() { if (destroyed) throw new DOMException('Transaction controller closed', 'AbortError'); cancel(); return stack.undo?.(); },
    redo() { if (destroyed) throw new DOMException('Transaction controller closed', 'AbortError'); cancel(); return stack.redo?.(); } };
}
