// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as ui from '../../sdk/ui/index.js';
import { parseLengthInput, formatPhysicalLength } from './measurement.js';

/** Canonical values are millimetres, degrees, or whole counts; display units never rescale state. */
export function normalizeFeatureDefinition(feature, { handle = false } = {}) {
  if (!feature || typeof feature.id !== 'string' || !feature.id || feature.id.length > 256 || !Number.isFinite(feature.value)) throw new TypeError('Features require a nonempty ID and finite value');
  if (feature.unit != null && !['mm', 'cm', 'in', 'deg', 'count'].includes(feature.unit)) throw new TypeError('Feature units must be mm, cm, in, deg or count');
  if (feature.unit === 'count' && ![feature.value, feature.min ?? 0, feature.max ?? 0, feature.step ?? 1].every(Number.isSafeInteger)) throw new TypeError('Count features need whole values and increments');
  for (const key of ['min', 'max', 'step', 'unitsPerDocumentUnit']) if (feature[key] != null && !Number.isFinite(feature[key])) throw new TypeError(`Feature ${key} must be finite`);
  if (feature.min != null && feature.value < feature.min || feature.max != null && feature.value > feature.max || feature.min != null && feature.max != null && feature.min > feature.max) throw new RangeError('Feature value is outside its supported range');
  if (feature.step != null && feature.step <= 0 || feature.unitsPerDocumentUnit != null && feature.unitsPerDocumentUnit <= 0) throw new RangeError('Feature increments must be positive');
  if (handle && (![feature.x, feature.y].every(Number.isFinite) || feature.axis != null && !['x', 'y'].includes(feature.axis))) throw new TypeError('Feature handles require finite coordinates and an x or y axis');
  if (feature.direction && (![feature.direction.x, feature.direction.y].every(Number.isFinite) || Math.hypot(feature.direction.x, feature.direction.y) === 0)) throw new TypeError('Feature direction must be a finite nonzero vector');
  return structuredClone(feature);
}

/** One value shared by an exact field and slider; the caller supplies the drafting rule. */
export function createFeatureControl({ feature, onEdit, onError = null } = {}) {
  if (typeof onEdit !== 'function') throw new TypeError('Feature controls require an edit callback');
  let current = normalizeFeatureDefinition(feature), active = null, destroyed = false;
  const exact = ui.input({ type: 'text' }), slider = ui.input({ type: 'range' });
  const label = ui.label(current.label || current.id), error = ui.el('span', { role: 'status', style: 'color:var(--fx-danger);font-size:var(--fx-text-xs);' });
  const root = ui.el('div', { class: 'fx-feature-control', style: 'display:grid;gap:var(--fx-space-2);min-width:0;' }, [label, exact, slider, error]);
  const offs = [], on = (target, event, handler) => offs.push(ui.on(target, event, handler));
  function render() {
    exact.setAttribute('aria-label', current.label || current.id); slider.setAttribute('aria-label', `${current.label || current.id} slider`);
    exact.value = current.unit === 'count' ? String(current.value) : current.unit === 'deg' ? `${current.value}°` : formatPhysicalLength(current.value, { unit: current.unit ?? 'mm', precision: 6 });
    const range = Number.isFinite(current.min) && Number.isFinite(current.max) && current.max > current.min;
    slider.hidden = !range;
    if (range) { slider.min = current.min; slider.max = current.max; slider.step = current.step ?? (current.unit === 'count' ? 1 : 'any'); slider.value = current.value; }
    exact.disabled = slider.disabled = current.disabled === true;
    label.textContent = current.label || current.id;
  }
  function send(phase, value, source) {
    onEdit({ phase, featureId: current.id, value, before: active?.before ?? current.value, source });
  }
  function begin(source) { if (!active) { active = { before: current.value, source }; send('begin', current.value, source); } }
  function cancel() {
    if (!active) return;
    const edit = active; current.value = edit.before;
    try { send('cancel', current.value, edit.source); } finally { active = null; render(); }
  }
  function update(value, source, commit = false) {
    if (destroyed || current.disabled) return;
    try {
      if (!Number.isFinite(value) || current.unit === 'count' && !Number.isSafeInteger(value) || current.min != null && value < current.min || current.max != null && value > current.max) throw new RangeError('Value is outside this feature’s supported range');
      begin(source); send('preview', value, source); current.value = value;
      if (commit) { send('commit', value, source); active = null; }
      error.textContent = ''; exact.removeAttribute('aria-invalid'); render();
    } catch (failure) {
      try { cancel(); } catch { active = null; }
      error.textContent = failure.message; exact.setAttribute('aria-invalid', 'true'); onError?.(failure);
    }
  }
  on(slider, 'input', () => update(Number(slider.value), 'slider'));
  on(slider, 'change', () => update(Number(slider.value), 'slider', true));
  on(slider, 'pointercancel', cancel);
  on(exact, 'change', () => {
    try {
      const angle = exact.value.replace(/(?:°|deg)\s*$/i, '').trim();
      if (current.unit === 'deg' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(angle)) throw new TypeError('Enter an angle in degrees');
      if (current.unit === 'count' && !/^[+-]?\d+$/.test(exact.value.trim())) throw new TypeError('Enter a whole count without a length unit');
      const value = current.unit === 'count' ? Number(exact.value.trim()) : current.unit === 'deg' ? Number(angle) : parseLengthInput(exact.value, { defaultUnit: current.unit ?? 'mm' }).valueMm;
      exact.removeAttribute('aria-invalid'); update(value, 'field', true);
    } catch (failure) { error.textContent = failure.message; exact.setAttribute('aria-invalid', 'true'); onError?.(failure); }
  });
  on(root, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
  render();
  return { root, exactInput: exact, slider, setFeature(next) { const checked = normalizeFeatureDefinition(next); if (next.id !== current.id) cancel(); current = checked; render(); },
    destroy() { if (destroyed) return; cancel(); destroyed = true; offs.splice(0).forEach(off => off()); root.remove(); } };
}
