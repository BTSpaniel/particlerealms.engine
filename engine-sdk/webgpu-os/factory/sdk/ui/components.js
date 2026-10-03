// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/components.js — reusable composed blocks (card, field, list, toolbar,
 * statusbar, sidebar) and the app-shell pattern. Apps compose these instead of
 * hand-building chrome.
 */

import { el, on } from './dom.js';
import { label } from './elements.js';

export function card(children, opts = {}) {
  return el('div', { class: 'fx-card' + (opts.class ? ` ${opts.class}` : ''), style: opts.style || '' }, children);
}

/** Section introduction shared by app pages; metadata may be text or a node. */
export function sectionHeader({ eyebrow = '', title = '', description = '', meta = null } = {}) {
  return el('header', { class: 'fx-section-header' }, [
    el('div', { class: 'fx-section-header__copy' }, [
      eyebrow ? el('div', { class: 'fx-section-header__eyebrow', text: eyebrow }) : null,
      el('h2', { class: 'fx-section-header__title', text: title }),
      description ? el('p', { class: 'fx-section-header__description', text: description }) : null,
    ]),
    meta == null ? null : el('div', { class: 'fx-section-header__meta' }, meta),
  ]);
}

const STATUS_TEXT = Object.freeze({ available: 'Available', unavailable: 'Unavailable', unknown: 'Unknown',
  disabled: 'Disabled', denied: 'Not permitted', missing: 'Not deployed', checking: 'Checking', error: 'Error' });

/** A visible state label; color never carries availability or permission alone. */
export function statusBadge(label = '', { state = 'unknown', detail = '', value = null } = {}) {
  if (!Object.hasOwn(STATUS_TEXT, state)) { state = 'unknown'; value = null; }
  const text = typeof value === 'string' && value.trim() ? value : STATUS_TEXT[state];
  return el('span', { class: 'fx-status-badge', dataset: { state }, title: detail || null,
    'aria-label': `${label ? `${label}: ` : ''}${text}${detail ? `. ${detail}` : ''}` }, [
    label ? el('span', { class: 'fx-status-badge__label', text: label }) : null,
    el('span', { class: 'fx-status-badge__state', text }),
  ]);
}

/** Labelled field. row=true puts label + control on one line (settings style). */
export function field(labelText, control, opts = {}) {
  return el('div', { class: 'fx-field' + (opts.row ? ' fx-field--row' : '') }, [
    label(labelText), control,
  ]);
}

/** Toolbar with title + actions. */
export function toolbar({ title, icon, subtitle = '', start = [], end = [] } = {}) {
  return el('div', { class: 'fx-toolbar' }, [
    icon ? el('span', { class: 'fx-icon', style: 'font-size:18px', text: icon }) : null,
    title ? (subtitle ? el('span', { class: 'fx-toolbar__brand' }, [
      el('span', { class: 'fx-toolbar__title', text: title }),
      el('span', { class: 'fx-toolbar__subtitle', text: subtitle }),
    ]) : el('span', { class: 'fx-toolbar__title', text: title })) : null,
    ...start,
    el('span', { class: 'fx-toolbar__spacer' }),
    ...end,
  ]);
}

export function statusbar(items = []) {
  return el('div', { class: 'fx-statusbar' }, items.map((i) => (i instanceof Node ? i : el('span', { text: String(i) }))));
}

/**
 * Selectable list.
 * @param {object} o { items:[{id,label,icon}], selected, onSelect }
 */
export function list(o = {}) {
  const node = el('div', { class: 'fx-list' });
  const render = (sel) => {
    node.textContent = '';
    for (const it of o.items || []) {
      const item = el('div', {
        class: 'fx-list__item', role: 'option', 'aria-selected': String(it.id === sel),
      }, [
        it.icon ? el('span', { class: 'fx-icon', text: it.icon }) : null,
        el('span', { text: it.label, style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
        it.trailing ? (it.trailing instanceof Node ? it.trailing : el('span', { class: 'fx-label', text: it.trailing })) : null,
      ]);
      on(item, 'click', () => { render(it.id); o.onSelect?.(it.id, it); });
      node.appendChild(item);
    }
  };
  render(o.selected);
  node.select = (id) => render(id);
  return node;
}

/**
 * App shell — the standard window layout: optional toolbar, optional sidebar,
 * scrollable body, optional status bar. Returns { root, body, sidebar }.
 * @param {object} o { toolbar?:Node, sidebar?:Node, statusbar?:Node, body?:Node }
 */
export function appShell(o = {}) {
  const body = el('div', { class: 'fx-body fx-animate-in' }, o.body || null);
  let mid = body;
  if (o.sidebar) {
    mid = el('div', { class: 'fx-row', style: 'flex:1;min-height:0;align-items:stretch;gap:0' }, [
      el('div', { class: 'fx-sidebar' }, o.sidebar), body,
    ]);
  }
  const root = el('div', { class: 'fx-shell fx-scope' }, [
    o.toolbar || null, mid, o.statusbar || null,
  ]);
  return { root, body, mountInRoot: (target) => { target.appendChild(root); return root; } };
}
