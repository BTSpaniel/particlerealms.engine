// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/game.js — arcade primitives shared by the bundled games.
 *
 * Games keep their bespoke playfield visuals (canvases, sprites, tiles) but
 * compose their *chrome* from these shared pieces: a full-bleed game shell with
 * toolbar + status rails, retro LED readouts, and a centered result overlay.
 */

import { el } from './dom.js';

/**
 * LED-style readout (mine counters, timers, scores).
 * @param {object} o { value, tone:'red'|'green'|'amber', title, min-width }
 * @returns {HTMLElement} node with .setValue(v) and .setTone(t)
 */
export function led({ value = '', tone = 'red', title = '', width = '' } = {}) {
  const cls = (t) => 'fx-led' + (t && t !== 'red' ? ` fx-led--${t}` : '');
  const node = el('div', { class: cls(tone), title, style: width ? `min-width:${width}` : '', text: String(value) });
  node.setValue = (v) => { node.textContent = String(v); return node; };
  node.setTone = (t) => { node.className = cls(t); if (width) node.style.minWidth = width; return node; };
  return node;
}

/**
 * Full-bleed game shell: toolbar / play stage / statusbar in a 3-row grid.
 * The stage is `position:relative` so backgrounds (.fx-game__bg) and overlays
 * (.fx-overlay) layer correctly. Returns { root, stage }.
 * @param {object} o { toolbar?:Node, stage?:Node|Node[], statusbar?:Node }
 */
export function gameShell({ toolbar, stage, statusbar } = {}) {
  const stageEl = stage instanceof HTMLElement && stage.classList.contains('fx-game__stage')
    ? stage
    : el('div', { class: 'fx-game__stage' }, stage ?? null);
  const root = el('div', { class: 'fx-game fx-scope' }, [toolbar || null, stageEl, statusbar || null]);
  return { root, stage: stageEl };
}

/**
 * Centered result/pause overlay for a game stage. Append once into a
 * `position:relative` ancestor (e.g. the gameShell stage), then drive with
 * .show({ title, detail, tone, actions }) / .hide().
 * @returns {HTMLElement} node with .show(opts) and .hide()
 */
export function overlay() {
  const titleEl = el('div', { class: 'fx-overlay__title' });
  const detailEl = el('div', { class: 'fx-overlay__detail' });
  const actionsEl = el('div', { class: 'fx-row' });
  const card = el('div', { class: 'fx-overlay__card' }, [titleEl, detailEl, actionsEl]);
  const node = el('div', { class: 'fx-overlay', hidden: true }, card);
  node.show = ({ title = '', detail = '', tone = '', actions = [] } = {}) => {
    titleEl.textContent = title;
    detailEl.textContent = detail;
    detailEl.style.display = detail ? '' : 'none';
    node.className = 'fx-overlay' + (tone ? ` fx-overlay--${tone}` : '');
    actionsEl.replaceChildren(...actions);
    actionsEl.style.display = actions.length ? '' : 'none';
    node.hidden = false;
    return node;
  };
  node.hide = () => { node.hidden = true; return node; };
  return node;
}
