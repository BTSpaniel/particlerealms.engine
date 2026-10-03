// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/elements.js — single display units (no interaction).
 */

import { el } from './dom.js';

export function label(text, opts = {}) {
  return el('span', { class: 'fx-label' + (opts.class ? ` ${opts.class}` : ''), text });
}

export function badge(text, opts = {}) {
  const node = el('span', { class: 'fx-badge', text });
  if (opts.color) node.style.color = opts.color;
  return node;
}

export function divider() { return el('hr', { class: 'fx-divider' }); }

export function icon(glyph, opts = {}) {
  return el('span', { class: 'fx-icon', text: glyph, style: opts.size ? `font-size:${opts.size}` : '' });
}

/** Empty / placeholder state. */
export function emptyState({ icon: glyph = '∅', title = '', hint = '' } = {}) {
  return el('div', { class: 'fx-empty' }, [
    el('div', { class: 'fx-empty__icon', text: glyph }),
    title ? el('div', { style: 'font-weight:550;color:var(--fx-text-muted)', text: title }) : null,
    hint ? el('div', { style: 'font-size:var(--fx-text-sm)', text: hint }) : null,
  ]);
}

export function spinner() {
  return el('div', {
    class: 'fx-icon',
    style: 'width:18px;height:18px;border-radius:50%;border:2px solid var(--fx-border);border-top-color:var(--fx-accent);animation:fx-spin .7s linear infinite;',
  });
}
