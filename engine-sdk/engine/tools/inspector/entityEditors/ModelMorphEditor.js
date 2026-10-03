// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createPropertySection } from '../ui/InspectorControls.js';
import { INSPECTOR_THEME } from '../ui/InspectorTheme.js';

function styleControl(control) {
  control.style.minWidth = '0';
  control.style.background = INSPECTOR_THEME.colors.bg.secondary;
  control.style.color = INSPECTOR_THEME.colors.text.primary;
  control.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  control.style.borderRadius = INSPECTOR_THEME.radius.sm;
  control.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm}`;
}

export async function renderModelMorphEditor(doc, container, options = {}) {
  const getDescriptor = options.getDescriptor;
  const setState = options.setState;
  if (typeof getDescriptor !== 'function' || typeof setState !== 'function') return false;
  let descriptor = await getDescriptor();
  if (!descriptor?.parts?.length
      || (typeof options.isCurrent === 'function' && !options.isCurrent())) return false;

  const section = createPropertySection(doc, container, 'Morph Targets');
  section.dataset.modelMorphEditor = String(options.entityId ?? '');
  const controls = new Map();

  async function commit(nextState) {
    const updated = await setState(nextState);
    if (updated?.parts) descriptor = updated;
    syncControls();
  }

  function stateWithPart(partIndex, update) {
    return descriptor.state.map((entry) => entry.partIndex === partIndex
      ? { ...entry, ...update, weights: update.weights ? [...update.weights] : [...entry.weights] }
      : { ...entry, weights: [...entry.weights] });
  }

  for (const part of descriptor.parts) {
    const group = doc.createElement('div');
    group.style.display = 'grid';
    group.style.gap = INSPECTOR_THEME.spacing.sm;
    group.style.paddingTop = INSPECTOR_THEME.spacing.sm;
    group.style.borderTop = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;

    const header = doc.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = 'minmax(0, 1fr) 96px 32px';
    header.style.alignItems = 'center';
    header.style.gap = INSPECTOR_THEME.spacing.sm;
    const title = doc.createElement('span');
    title.textContent = part.name;
    title.title = part.name;
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';
    title.style.fontSize = INSPECTOR_THEME.fontSize.md;
    title.style.color = INSPECTOR_THEME.colors.text.secondary;
    const modeSelect = doc.createElement('select');
    styleControl(modeSelect);
    for (const [value, label] of [['animated', 'Animated'], ['manual', 'Manual']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    }
    const resetButton = doc.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = '↺';
    resetButton.title = 'Return morph targets to animation';
    resetButton.style.width = '32px';
    resetButton.style.height = '30px';
    resetButton.style.cursor = 'pointer';
    styleControl(resetButton);
    header.append(title, modeSelect, resetButton);
    group.appendChild(header);

    const targetControls = [];
    for (const target of part.targets) {
      const row = doc.createElement('label');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '72px minmax(0, 1fr) 68px';
      row.style.alignItems = 'center';
      row.style.gap = INSPECTOR_THEME.spacing.sm;
      const label = doc.createElement('span');
      label.textContent = target.name;
      label.title = target.name;
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';
      label.style.fontSize = INSPECTOR_THEME.fontSize.sm;
      const slider = doc.createElement('input');
      slider.type = 'range';
      slider.min = String(Math.min(-2, Math.floor(target.manualWeight)));
      slider.max = String(Math.max(2, Math.ceil(target.manualWeight)));
      slider.step = '0.001';
      slider.style.width = '100%';
      const number = doc.createElement('input');
      number.type = 'number';
      number.min = '-10000';
      number.max = '10000';
      number.step = '0.001';
      styleControl(number);
      row.append(label, slider, number);
      group.appendChild(row);
      targetControls.push({ slider, number });

      const changeWeight = (value) => {
        const current = descriptor.state.find((entry) => entry.partIndex === part.partIndex);
        if (!current || !Number.isFinite(value)) return;
        const weights = [...current.weights];
        weights[target.index] = value;
        commit(stateWithPart(part.partIndex, { mode: 'manual', weights }));
      };
      slider.addEventListener('change', () => changeWeight(Number(slider.value)));
      number.addEventListener('change', () => changeWeight(Number(number.value)));
    }
    modeSelect.addEventListener('change', () => commit(stateWithPart(part.partIndex, { mode: modeSelect.value })));
    resetButton.addEventListener('click', () => commit(stateWithPart(part.partIndex, { mode: 'animated' })));
    controls.set(part.partIndex, { modeSelect, targetControls });
    section.appendChild(group);
  }

  function syncControls() {
    for (const part of descriptor.parts) {
      const partControls = controls.get(part.partIndex);
      const state = descriptor.state.find((entry) => entry.partIndex === part.partIndex);
      if (!partControls || !state) continue;
      partControls.modeSelect.value = state.mode;
      for (const target of part.targets) {
        const targetControl = partControls.targetControls[target.index];
        if (!targetControl) continue;
        const value = state.mode === 'manual' ? state.weights[target.index] : target.weight;
        targetControl.slider.min = String(Math.min(-2, Math.floor(value)));
        targetControl.slider.max = String(Math.max(2, Math.ceil(value)));
        targetControl.slider.value = String(value);
        targetControl.number.value = Number(value).toFixed(3);
      }
    }
  }
  syncControls();

  let lastRefresh = 0;
  const refresh = async (timestamp) => {
    if (!section.isConnected || (typeof options.isCurrent === 'function' && !options.isCurrent())) return;
    if (timestamp - lastRefresh >= 100) {
      const updated = await getDescriptor();
      if (updated?.parts) {
        descriptor = updated;
        syncControls();
      }
      lastRefresh = timestamp;
    }
    requestAnimationFrame(refresh);
  };
  requestAnimationFrame(refresh);
  return true;
}
