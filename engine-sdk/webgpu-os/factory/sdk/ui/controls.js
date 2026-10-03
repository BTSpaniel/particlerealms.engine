// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/controls.js — atomic interactive controls.
 *
 * Each returns a DOM node wired to the shared stylesheet (.fx-*). Behaviour is
 * headless-ish: state lives in the caller, controls expose value/onChange. No
 * app reimplements buttons, inputs, toggles, etc.
 */

import { el, on } from './dom.js';

let menuSelectSequence = 0;

/**
 * @param {object} o { label, icon, variant:'default'|'primary'|'ghost'|'danger',
 *                      size:'sm'|'md', block, title, disabled, onClick }
 */
export function button(o = {}) {
  const cls = ['fx-btn'];
  if (o.variant && o.variant !== 'default') cls.push(`fx-btn--${o.variant}`);
  if (o.size === 'sm') cls.push('fx-btn--sm');
  if (o.block) cls.push('fx-btn--block');
  const node = el('button', {
    class: cls.join(' '), type: 'button', title: o.title || '',
    disabled: !!o.disabled,
  }, [o.icon ? el('span', { class: 'fx-icon', text: o.icon }) : null, o.label != null ? el('span', { text: o.label }) : null]);
  if (o.onClick) on(node, 'click', o.onClick);
  return node;
}

export function iconButton(o = {}) {
  const node = el('button', {
    class: 'fx-btn fx-btn--icon' + (o.variant ? ` fx-btn--${o.variant}` : ''),
    type: 'button', title: o.title || '', 'aria-label': o.title || o.icon || 'button',
  }, el('span', { class: 'fx-icon', text: o.icon || '' }));
  if (o.onClick) on(node, 'click', o.onClick);
  return node;
}

export function input(o = {}) {
  const node = el('input', {
    class: 'fx-input', type: o.type || 'text',
    // Set native constraints before value: a range otherwise sanitizes against
    // its default 0–100 bounds and can irreversibly clamp the caller's value.
    min: o.min, max: o.max, step: o.step, value: o.value ?? '',
    placeholder: o.placeholder || '', disabled: !!o.disabled,
  });
  if (o.onInput) on(node, 'input', (e) => o.onInput(e.target.value, e));
  if (o.onChange) on(node, 'change', (e) => o.onChange(e.target.value, e));
  if (o.onEnter) on(node, 'keydown', (e) => { if (e.key === 'Enter') o.onEnter(node.value, e); });
  return node;
}

export function textarea(o = {}) {
  const node = el('textarea', { class: 'fx-textarea', value: o.value ?? '', placeholder: o.placeholder || '' });
  if (o.onInput) on(node, 'input', (e) => o.onInput(e.target.value, e));
  return node;
}

/** @param {object} o { options:[{value,label}]|string[], value, onChange } */
export function select(o = {}) {
  const opts = (o.options || []).map((opt) => {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : (opt.label ?? opt.value);
    return el('option', { value, text: label, selected: value === o.value });
  });
  const node = el('select', { class: 'fx-select' }, opts);
  if (o.onChange) on(node, 'change', (e) => o.onChange(e.target.value, e));
  return node;
}

/** Fully themed select/listbox. topLayer escapes clipping in scrolling toolbars. */
export function menuSelect(o = {}) {
  const items = (o.options || []).map((item) => typeof item === 'string'
    ? { value: item, label: item, disabled: false }
    : { value: item.value, label: item.label ?? item.value, disabled: !!item.disabled });
  const listId = `fx-menu-select-${++menuSelectSequence}`;
  const label = el('span', { class: 'fx-menu-select__value' });
  const list = el('div', { class: 'fx-menu-select__popup', id: listId, role: 'listbox', hidden: true });
  const node = el('div', {
    class: 'fx-select fx-menu-select', role: 'combobox', tabIndex: 0,
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId,
  }, [label, el('span', { class: 'fx-menu-select__chevron', text: '⌄', 'aria-hidden': 'true' }), list]);
  const topLayer = o.topLayer === true && typeof list.showPopover === 'function';
  if (topLayer) list.setAttribute('popover', 'manual');
  if (o.disabled) { node.setAttribute('aria-disabled', 'true'); node.tabIndex = -1; }
  let current = items.some(item => String(item.value) === String(o.value)) ? String(o.value) : String(items.find(item => !item.disabled)?.value ?? '');
  let activeIndex = Math.max(0, items.findIndex(item => String(item.value) === current));
  let offOutside = null;
  let offScroll = null;
  let offResize = null;

  const options = items.map((item, index) => {
    const option = el('button', {
      class: 'fx-menu-select__option', type: 'button', role: 'option',
      disabled: item.disabled, text: item.label, dataset: { value: String(item.value) },
    });
    on(option, 'click', event => {
      event.stopPropagation();
      if (item.disabled) return;
      setValue(item.value, true);
      close();
      node.focus();
    });
    list.appendChild(option);
    return option;
  });

  function render() {
    const selected = items.find(item => String(item.value) === current);
    label.textContent = selected?.label ?? '';
    options.forEach((option, index) => {
      const isSelected = String(items[index].value) === current;
      option.setAttribute('aria-selected', String(isSelected));
      option.classList.toggle('active', index === activeIndex);
    });
    const active = options[activeIndex];
    if (active) node.setAttribute('aria-activedescendant', active.id ||= `${listId}-option-${activeIndex}`);
  }

  function setValue(value, emit = false) {
    const index = items.findIndex(item => String(item.value) === String(value) && (!emit || !item.disabled));
    if (index < 0) return;
    current = String(items[index].value);
    activeIndex = index;
    render();
    if (emit) node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    if (!list.hidden || node.getAttribute('aria-disabled') === 'true') return;
    const bounds = node.getBoundingClientRect();
    const shell = node.closest('.fx-shell')?.getBoundingClientRect();
    const lowerEdge = shell?.bottom ?? globalThis.innerHeight ?? bounds.bottom + 240;
    node.classList.toggle('fx-menu-select--up', lowerEdge - bounds.bottom < 220 && bounds.top - (shell?.top ?? 0) > lowerEdge - bounds.bottom);
    list.hidden = false;
    if (topLayer) {
      list.showPopover();
      const width = list.getBoundingClientRect().width;
      const upward = node.classList.contains('fx-menu-select--up');
      const available = Math.max(44, upward ? bounds.top - (shell?.top ?? 0) - 10 : lowerEdge - bounds.bottom - 10);
      list.style.maxHeight = `${Math.min(330, available)}px`;
      Object.assign(list.style, {
        left: `${Math.max(6, Math.min(bounds.left, globalThis.innerWidth - width - 6))}px`,
        top: `${upward ? bounds.top - list.getBoundingClientRect().height - 5 : bounds.bottom + 5}px`,
        right: 'auto', bottom: 'auto',
      });
      offScroll = on(node.ownerDocument, 'scroll', event => {
        if (list.contains(event.target)) return;
        const currentBounds = node.getBoundingClientRect();
        if (Math.abs(currentBounds.left - bounds.left) > .5 || Math.abs(currentBounds.top - bounds.top) > .5) close();
      }, true);
      offResize = on(node.ownerDocument.defaultView, 'resize', close);
    }
    node.setAttribute('aria-expanded', 'true');
    revealActive();
    offOutside = on(node.ownerDocument, 'pointerdown', event => { if (!node.contains(event.target)) close(); }, true);
  }

  function close() {
    if (topLayer && list.matches(':popover-open')) list.hidePopover();
    list.hidden = true;
    node.setAttribute('aria-expanded', 'false');
    offOutside?.();
    offOutside = null;
    offScroll?.(); offScroll = null;
    offResize?.(); offResize = null;
  }

  function revealActive() {
    const option = options[activeIndex];
    if (!option || list.hidden) return;
    // Scroll only this list; scrollIntoView also moves its toolbar ancestors.
    const item = option.getBoundingClientRect(), viewport = list.getBoundingClientRect();
    if (item.top < viewport.top + 5) list.scrollTop += item.top - viewport.top - 5;
    else if (item.bottom > viewport.bottom - 5) list.scrollTop += item.bottom - viewport.bottom + 5;
  }

  function move(delta) {
    let next = activeIndex;
    do { next = (next + delta + items.length) % items.length; }
    while (items[next]?.disabled && next !== activeIndex);
    activeIndex = next;
    render();
    revealActive();
  }

  on(node, 'click', event => { if (!event.target.closest('.fx-menu-select__option')) list.hidden ? open() : close(); });
  on(node, 'change', event => o.onChange?.(current, event));
  on(node, 'keydown', event => {
    if (node.getAttribute('aria-disabled') === 'true') return;
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); move(event.key === 'ArrowDown' ? 1 : -1); return; }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); activeIndex = event.key === 'Home' ? items.findIndex(item => !item.disabled) : items.findLastIndex(item => !item.disabled); render(); revealActive(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && !list.hidden) { event.preventDefault(); setValue(items[activeIndex]?.value, true); close(); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
  Object.defineProperty(node, 'value', { get: () => current, set: value => setValue(value) });
  Object.defineProperty(node, 'options', { get: () => options });
  node.setValue = (value, emit = false) => setValue(value, emit);
  node.closeMenu = close;
  render();
  return node;
}

/** @param {object} o { checked, onChange } */
export function toggle(o = {}) {
  const node = el('button', { class: 'fx-toggle', role: 'switch', 'aria-checked': String(!!o.checked), type: 'button' });
  on(node, 'click', () => {
    const next = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', String(next));
    o.onChange?.(next);
  });
  return node;
}

/** @param {object} o { min, max, step, value, onInput } */
export function slider(o = {}) {
  const node = el('input', {
    class: 'fx-slider', type: 'range',
    min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1, value: o.value ?? 0,
  });
  if (o.onInput) on(node, 'input', (e) => o.onInput(Number(e.target.value), e));
  return node;
}

/**
 * Segmented control (mode switcher).
 * @param {object} o { items:[{value,label}]|string[], value, onChange, role? }
 */
export function segmented(o = {}) {
  const items = o.items || [];
  const groupRole = o.role === 'radiogroup' ? 'radiogroup' : 'tablist';
  const itemRole = groupRole === 'radiogroup' ? 'radio' : 'tab';
  const stateAttribute = groupRole === 'radiogroup' ? 'aria-checked' : 'aria-selected';
  const node = el('div', { class: 'fx-segmented', role: groupRole, 'aria-label': o.ariaLabel });
  const entries = items.map((item) => ({
    value: typeof item === 'string' ? item : item.value,
    label: typeof item === 'string' ? item : (item.label ?? item.value),
    button: null,
  }));
  let current = o.value ?? entries[0]?.value;
  const update = (active, focus = false) => {
    if (!entries.some((entry) => entry.value === active)) active = entries[0]?.value;
    current = active;
    for (const entry of entries) {
      const selected = entry.value === current;
      entry.button?.setAttribute(stateAttribute, String(selected));
      if (entry.button) entry.button.tabIndex = selected ? 0 : -1;
    }
    if (focus) entries.find((entry) => entry.value === current)?.button?.focus();
  };
  for (const [index, entry] of entries.entries()) {
    const button = el('button', { class: 'fx-segmented__item', type: 'button', text: entry.label, role: itemRole });
    entry.button = button;
    on(button, 'click', () => { update(entry.value); o.onChange?.(entry.value); });
    on(button, 'keydown', (event) => {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!direction && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const targetIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : (index + direction + entries.length) % entries.length;
      const nextValue = entries[targetIndex]?.value;
      if (nextValue == null) return;
      update(nextValue, true);
      o.onChange?.(nextValue);
    });
    node.appendChild(button);
  }
  update(current);
  node.setValue = (value) => { if (value !== current) update(value); };
  Object.defineProperty(node, 'value', { get: () => current, set: (value) => node.setValue(value) });
  return node;
}
