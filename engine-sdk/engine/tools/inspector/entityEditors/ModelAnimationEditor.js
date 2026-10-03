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

function createRow(doc, labelText) {
  const row = doc.createElement('label');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '72px minmax(0, 1fr)';
  row.style.alignItems = 'center';
  row.style.gap = INSPECTOR_THEME.spacing.sm;
  const label = doc.createElement('span');
  label.textContent = labelText;
  label.style.fontSize = INSPECTOR_THEME.fontSize.md;
  label.style.color = INSPECTOR_THEME.colors.text.secondary;
  row.appendChild(label);
  return row;
}

export async function renderModelAnimationEditor(doc, container, options = {}) {
  const getDescriptor = options.getDescriptor;
  const setState = options.setState;
  if (typeof getDescriptor !== 'function' || typeof setState !== 'function') return false;
  let descriptor = await getDescriptor();
  if (!descriptor || !Array.isArray(descriptor.clips) || descriptor.clips.length === 0
      || (typeof options.isCurrent === 'function' && !options.isCurrent())) return false;

  const section = createPropertySection(doc, container, 'Animation');
  section.dataset.modelAnimationEditor = String(options.entityId ?? '');

  const clipRow = createRow(doc, 'Clip');
  const clipSelect = doc.createElement('select');
  styleControl(clipSelect);
  for (const clip of descriptor.clips) {
    const option = doc.createElement('option');
    option.value = String(clip.index);
    option.textContent = clip.name;
    clipSelect.appendChild(option);
  }
  clipRow.appendChild(clipSelect);
  section.appendChild(clipRow);

  const transport = doc.createElement('div');
  transport.style.display = 'grid';
  transport.style.gridTemplateColumns = '32px 32px minmax(0, 1fr)';
  transport.style.gap = INSPECTOR_THEME.spacing.sm;
  const playButton = doc.createElement('button');
  const restartButton = doc.createElement('button');
  for (const button of [playButton, restartButton]) {
    button.type = 'button';
    button.style.width = '32px';
    button.style.height = '30px';
    button.style.cursor = 'pointer';
    styleControl(button);
  }
  restartButton.textContent = '↺';
  restartButton.title = 'Restart animation';
  const timeSlider = doc.createElement('input');
  timeSlider.type = 'range';
  timeSlider.min = '0';
  timeSlider.step = '0.001';
  timeSlider.style.width = '100%';
  transport.append(playButton, restartButton, timeSlider);
  section.appendChild(transport);

  const timeText = doc.createElement('div');
  timeText.style.textAlign = 'right';
  timeText.style.fontVariantNumeric = 'tabular-nums';
  timeText.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  timeText.style.color = INSPECTOR_THEME.colors.text.muted;
  section.appendChild(timeText);

  const speedRow = createRow(doc, 'Speed');
  const speedInput = doc.createElement('input');
  speedInput.type = 'number';
  speedInput.min = '-16';
  speedInput.max = '16';
  speedInput.step = '0.1';
  styleControl(speedInput);
  speedRow.appendChild(speedInput);
  section.appendChild(speedRow);

  const loopRow = createRow(doc, 'Loop');
  const loopInput = doc.createElement('input');
  loopInput.type = 'checkbox';
  loopInput.style.justifySelf = 'start';
  loopRow.appendChild(loopInput);
  section.appendChild(loopRow);

  function selectedClip() {
    return descriptor.clips[descriptor.state.clipIndex] || descriptor.clips[0];
  }

  function syncControls() {
    const state = descriptor.state;
    const clip = selectedClip();
    const duration = Math.max(0, Number(clip?.duration) || 0);
    clipSelect.value = String(state.clipIndex);
    playButton.textContent = state.playing ? 'Ⅱ' : '▶';
    playButton.title = state.playing ? 'Pause animation' : 'Play animation';
    timeSlider.max = String(duration);
    timeSlider.value = String(Math.min(duration, Math.max(0, state.time)));
    timeSlider.disabled = duration <= 0;
    timeText.textContent = `${state.time.toFixed(3)} / ${duration.toFixed(3)} s`;
    speedInput.value = String(state.speed);
    loopInput.checked = state.loop;
  }

  async function commit(patch) {
    const next = { ...descriptor.state, ...patch };
    const updated = await setState(next);
    if (updated?.state) descriptor = updated;
    syncControls();
  }

  clipSelect.addEventListener('change', () => commit({ clipIndex: Number(clipSelect.value), time: 0 }));
  playButton.addEventListener('click', () => commit({ playing: !descriptor.state.playing }));
  restartButton.addEventListener('click', () => commit({ time: 0 }));
  timeSlider.addEventListener('change', () => commit({ time: Number(timeSlider.value) }));
  speedInput.addEventListener('change', () => commit({ speed: Number(speedInput.value) }));
  loopInput.addEventListener('change', () => commit({ loop: loopInput.checked }));
  syncControls();

  let lastRefresh = 0;
  const refresh = async (timestamp) => {
    if (!section.isConnected || (typeof options.isCurrent === 'function' && !options.isCurrent())) return;
    if (timestamp - lastRefresh >= 100) {
      const updated = await getDescriptor();
      if (updated?.state) {
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
