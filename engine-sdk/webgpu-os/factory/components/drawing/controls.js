// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as ui from '../../sdk/ui/index.js';
import { normalizeHexColor } from './color.js';

/** Shared controlled color field; the consumer owns persistence and color history. */
export function createColorControl({ value = '#17212b', label = 'Stroke color', onChange = null } = {}) {
  const input = ui.input({ type: 'color', value: normalizeHexColor(value), onChange: next => onChange?.(next) });
  input.setAttribute('aria-label', label);
  const root = ui.field(label, input);
  input.style.cssText = 'width:38px;height:32px;padding:3px;cursor:pointer;';
  root.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:var(--fx-space-2);flex:none;';
  return { root, setValue(next) { input.value = normalizeHexColor(next); }, getValue: () => input.value, destroy() { root.remove(); } };
}

/** Records can be Paint layers, PDF optional-content groups, or editable paths. */
export function createLayersPanel({ rows = [], activeId = '', onCommand = null, label = 'Layers' } = {}) {
  const root = ui.el('section', { class: 'fx-drawing-layers', 'aria-label': label, style: 'display:flex;flex-direction:column;gap:var(--fx-space-2);overflow:auto;min-width:0;color:var(--fx-text);' });
  const heading = ui.el('strong', { text: label, style: 'font-size:var(--fx-text-sm);font-weight:var(--fx-weight-bold);' });
  const list = ui.el('div', { role: 'list', style: 'display:flex;flex-direction:column;gap:var(--fx-space-1);' });
  root.append(heading, list);
  function render() {
    const focused = root.contains(document.activeElement) ? document.activeElement.dataset : null;
    const focusId = focused?.layerId, focusCommand = focused?.layerCommand;
    list.replaceChildren(...rows.map((source, index) => {
      const row = source.layer ? { ...source.layer, depth: source.depth } : source;
      const select = ui.button({ label: row.name || row.label || row.id, variant: 'ghost', size: 'sm', onClick: () => onCommand?.({ type: 'select', id: row.id }) });
      select.title = row.name || row.label || row.id;
      select.style.cssText = `flex:1;min-width:0;justify-content:flex-start;text-align:left;white-space:normal;padding:5px 6px;color:${row.id === activeId ? 'var(--fx-accent)' : 'var(--fx-text)'};`;
      select.firstChild.style.cssText = 'overflow-wrap:anywhere;';
      select.setAttribute('aria-pressed', String(row.id === activeId));
      select.dataset.layerId = row.id; select.dataset.layerCommand = 'select';
      const visibility = ui.input({ type: 'checkbox', onChange: (_, event) => onCommand?.({ type: 'visibility', id: row.id, value: event.target.checked }) });
      visibility.style.cssText = 'width:16px;height:16px;flex:none;padding:0;margin:0;accent-color:var(--fx-accent);cursor:pointer;';
      visibility.checked = row.visible !== false; visibility.disabled = row.canToggle === false;
      visibility.setAttribute('aria-label', `Show ${row.name || row.label || row.id}`);
      visibility.dataset.layerId = row.id; visibility.dataset.layerCommand = 'visibility';
      const controls = [visibility, select];
      if (row.canLock !== false) {
        const lock = ui.button({ label: row.locked ? 'Unlock' : 'Lock', title: `${row.locked ? 'Unlock' : 'Lock'} ${row.name || row.label || row.id}`, size: 'sm', onClick: () => onCommand?.({ type: 'lock', id: row.id, value: !row.locked }) });
        lock.setAttribute('aria-pressed', String(!!row.locked));
        lock.dataset.layerId = row.id; lock.dataset.layerCommand = 'lock';
        if (row.locked) lock.style.cssText = 'background:var(--fx-accent-soft);border-color:var(--fx-accent);';
        controls.push(lock);
      }
      if (row.canReorder) for (const direction of [-1, 1]) {
        const move = ui.button({ label: direction < 0 ? '↑' : '↓', title: direction < 0 ? 'Move up' : 'Move down', disabled: direction < 0 ? index === 0 : index === rows.length - 1, size: 'sm', onClick: () => onCommand?.({ type: 'move', id: row.id, direction }) });
        move.setAttribute('aria-label', `${direction < 0 ? 'Move up' : 'Move down'} ${row.name || row.label || row.id}`);
        move.dataset.layerId = row.id; move.dataset.layerCommand = `move${direction}`;
        controls.push(move);
      }
      const line = ui.el('div', { style: 'display:flex;align-items:center;gap:5px;min-width:0;' }, controls.slice(0, 2));
      const actions = controls.length > 2 ? ui.el('div', { style: 'display:flex;justify-content:flex-end;gap:var(--fx-space-1);' }, controls.slice(2)) : null;
      return ui.el('div', { role: 'listitem', 'data-selected': String(row.id === activeId), style: `display:flex;flex-direction:column;gap:3px;padding:var(--fx-space-1);margin-left:${Math.min(5, Math.max(0, row.depth || 0)) * 8}px;border:1px solid ${row.id === activeId ? 'var(--fx-accent)' : 'var(--fx-border-faint)'};border-radius:var(--fx-radius-sm);background:${row.id === activeId ? 'var(--fx-accent-soft)' : 'transparent'};` }, [line, actions]);
    }));
    if (!rows.length) list.append(ui.el('p', { text: 'No objects yet.', style: 'margin:var(--fx-space-2) 0;color:var(--fx-text-muted);font-size:var(--fx-text-sm);' }));
    if (focusId && focusCommand) [...list.querySelectorAll('[data-layer-id]')].find(node => node.dataset.layerId === focusId && node.dataset.layerCommand === focusCommand)?.focus({ preventScroll: true });
  }
  render();
  return { root, setRows(next, selected = activeId) { rows = next; activeId = selected; render(); }, destroy() { root.remove(); } };
}

export function createDrawingToolControl({ tools = [], value = 'select', onChange = null } = {}) {
  const root = ui.select({ options: tools.map(tool => ({ value: tool.id, label: tool.label })), value, onChange });
  root.setAttribute('aria-label', 'Drawing tool');
  return { root, setValue(next) { root.value = next; }, getValue: () => root.value, destroy() { root.remove(); } };
}
