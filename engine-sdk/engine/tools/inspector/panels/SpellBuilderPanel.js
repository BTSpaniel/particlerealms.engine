// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spell Builder Inspector Panel
 * 
 * Real-time spell effect editor integrated with the engine inspector.
 * Allows creating, customizing, and previewing particle-based spells.
 */

import { 
  SPELL_CATEGORIES, 
  SPELL_PRESETS, 
  SPELL_PARAM_SCHEMA,
  cloneSpellConfig,
  rgbToHex,
  hexToRgb
} from './spell-configs/SpellConfig.js';
import { getSpellBook } from './spell-configs/SpellBook.js';
import { createEmitterConfig } from './spell-configs/SpellEffectFactory.js';

// ============================================================================
// PANEL INITIALIZATION
// ============================================================================

export function initSpellBuilderPanel(container, options = {}) {
  const state = {
    currentCategory: 'combat',
    currentSpellId: 'fireball',
    currentConfig: cloneSpellConfig('fireball'),
    isEditing: false,
    previewActive: true,
    listeners: new Set()
  };
  
  const elements = createPanelDOM(container, state, options);
  setupEventListeners(elements, state, options);
  updateUI(elements, state);
  
  return {
    getState: () => ({ ...state }),
    setSpell: (spellId) => loadSpell(spellId, elements, state),
    getCurrentConfig: () => state.currentConfig,
    destroy: () => destroyPanel(elements, state)
  };
}

// ============================================================================
// DOM CREATION
// ============================================================================

function createPanelDOM(container, state, options) {
  const panel = document.createElement('div');
  panel.className = 'spell-builder-panel';
  panel.innerHTML = `
    <style>
      .spell-builder-panel {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e4e4e7;
        background: #0a0a0f;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .spell-builder-header {
        background: #0a0a0f;
        padding: 12px;
        border-bottom: 1px solid #1e1e2e;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .spell-builder-title {
        font-size: 16px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .spell-builder-actions {
        display: flex;
        gap: 8px;
      }
      
      .spell-btn {
        padding: 6px 12px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .spell-btn-primary {
        background: #3b82f6;
        color: white;
      }
      
      .spell-btn-primary:hover {
        background: #2563eb;
      }
      
      .spell-btn-success {
        background: #10b981;
        color: white;
      }
      
      .spell-btn-success:hover {
        background: #059669;
      }
      
      .spell-btn-danger {
        background: #ef4444;
        color: white;
      }
      
      .spell-builder-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      
      .category-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      
      .category-tab {
        padding: 6px 12px;
        background: #0f0f16;
        border: none;
        border-radius: 6px;
        color: #71717a;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      
      .category-tab:hover {
        background: rgba(255,255,255,0.1);
        color: #e4e4e7;
      }
      
      .category-tab.active {
        background: #3b82f6;
        color: white;
      }
      
      .preset-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }
      
      .preset-btn {
        padding: 12px 8px;
        background: #0a0a0f;
        border: 2px solid #1e1e2e;
        border-radius: 8px;
        color: white;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
      }
      
      .preset-btn:hover {
        border-color: #2a2a3a;
        background: #0f0f16;
      }
      
      .preset-btn.active {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.15);
      }
      
      .preset-icon {
        font-size: 24px;
        margin-bottom: 4px;
      }
      
      .preset-name {
        font-size: 12px;
        color: #71717a;
      }
      
      .section {
        margin-bottom: 16px;
      }
      
      .section-title {
        font-size: 11px;
        font-weight: 600;
        color: #52525b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      
      .form-group {
        margin-bottom: 12px;
      }
      
      .form-label {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #a1a1aa;
        margin-bottom: 4px;
      }
      
      .form-value {
        color: #3b82f6;
        font-weight: 500;
      }
      
      .form-slider {
        width: 100%;
        height: 6px;
        -webkit-appearance: none;
        background: #27272a;
        border-radius: 3px;
        outline: none;
      }
      
      .form-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: #3b82f6;
        border-radius: 50%;
        cursor: pointer;
      }
      
      .form-color {
        width: 100%;
        height: 32px;
        border: 1px solid #27272a;
        border-radius: 6px;
        background: #0a0a0f;
        cursor: pointer;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      
      .stat-card {
        background: #0a0a0f;
        padding: 8px;
        border-radius: 6px;
        text-align: center;
        border: 1px solid #1e1e2e;
      }
      
      .stat-label {
        font-size: 10px;
        color: #52525b;
        text-transform: uppercase;
      }
      
      .stat-value {
        font-size: 16px;
        font-weight: 600;
        color: #f59e0b;
        margin-top: 2px;
      }
      
      .spell-name-input {
        width: 100%;
        padding: 8px;
        background: #0a0a0f;
        border: 1px solid #27272a;
        border-radius: 6px;
        color: white;
        font-size: 14px;
      }
      
      .spell-name-input:focus {
        outline: none;
        border-color: #3b82f6;
      }
    </style>
    
    <div class="spell-builder-header">
      <div class="spell-builder-title">
        <span>✨</span>
        <span>Spell Builder</span>
      </div>
      <div class="spell-builder-actions">
        <button class="spell-btn spell-btn-success" id="saveSpellBtn">💾 Save</button>
        <button class="spell-btn spell-btn-primary" id="exportSpellBtn">📤 Export</button>
      </div>
    </div>
    
    <div class="spell-builder-content">
      <div class="section">
        <div class="section-title">Spell Name</div>
        <input type="text" class="spell-name-input" id="spellNameInput" placeholder="Enter spell name...">
      </div>
      
      <div class="section">
        <div class="section-title">Category</div>
        <div class="category-tabs" id="categoryTabs"></div>
      </div>
      
      <div class="section">
        <div class="section-title">Presets</div>
        <div class="preset-grid" id="presetGrid"></div>
      </div>
      
      <div class="section">
        <div class="section-title">Parameters</div>
        <div id="parameterControls"></div>
      </div>
      
      <div class="section">
        <div class="section-title">Colors</div>
        <div id="colorControls"></div>
      </div>
      
      <div class="section">
        <div class="section-title">Statistics</div>
        <div class="stats-grid" id="statsGrid"></div>
      </div>
    </div>
  `;
  
  container.appendChild(panel);
  
  return {
    panel,
    categoryTabs: panel.querySelector('#categoryTabs'),
    presetGrid: panel.querySelector('#presetGrid'),
    parameterControls: panel.querySelector('#parameterControls'),
    colorControls: panel.querySelector('#colorControls'),
    statsGrid: panel.querySelector('#statsGrid'),
    spellNameInput: panel.querySelector('#spellNameInput'),
    saveBtn: panel.querySelector('#saveSpellBtn'),
    exportBtn: panel.querySelector('#exportSpellBtn')
  };
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners(elements, state, options) {
  // Category tabs
  elements.categoryTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('category-tab')) {
      state.currentCategory = e.target.dataset.category;
      updateUI(elements, state);
    }
  });
  
  // Preset selection
  elements.presetGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (btn) {
      loadSpell(btn.dataset.spellId, elements, state, options);
    }
  });
  
  // Spell name
  elements.spellNameInput.addEventListener('input', (e) => {
    state.currentConfig.name = e.target.value;
    notifyChange(state, options);
  });
  
  // Save button
  elements.saveBtn.addEventListener('click', () => {
    saveSpell(state, options);
  });
  
  // Export button
  elements.exportBtn.addEventListener('click', () => {
    exportSpell(state);
  });
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateUI(elements, state) {
  renderCategoryTabs(elements, state);
  renderPresetGrid(elements, state);
  renderParameterControls(elements, state);
  renderColorControls(elements, state);
  renderStats(elements, state);
  
  elements.spellNameInput.value = state.currentConfig.name || '';
}

function renderCategoryTabs(elements, state) {
  elements.categoryTabs.innerHTML = '';
  
  for (const [id, cat] of Object.entries(SPELL_CATEGORIES)) {
    const btn = document.createElement('button');
    btn.className = 'category-tab' + (id === state.currentCategory ? ' active' : '');
    btn.dataset.category = id;
    btn.textContent = `${cat.icon} ${cat.name}`;
    elements.categoryTabs.appendChild(btn);
  }
}

function renderPresetGrid(elements, state) {
  elements.presetGrid.innerHTML = '';
  
  for (const [id, preset] of Object.entries(SPELL_PRESETS)) {
    if (preset.category !== state.currentCategory) continue;
    
    const btn = document.createElement('button');
    btn.className = 'preset-btn' + (id === state.currentSpellId ? ' active' : '');
    btn.dataset.spellId = id;
    btn.innerHTML = `
      <div class="preset-icon">${preset.icon}</div>
      <div class="preset-name">${preset.name}</div>
    `;
    elements.presetGrid.appendChild(btn);
  }
}

function renderParameterControls(elements, state, options) {
  elements.parameterControls.innerHTML = '';
  const params = state.currentConfig.params;
  
  const paramKeys = ['speed', 'size', 'intensity', 'particleCount', 'gravity'];
  
  for (const key of paramKeys) {
    if (params[key] === undefined) continue;
    
    const schema = SPELL_PARAM_SCHEMA[key];
    if (!schema) continue;
    
    const group = document.createElement('div');
    group.className = 'form-group';
    group.innerHTML = `
      <div class="form-label">
        <span>${schema.label}</span>
        <span class="form-value" id="value_${key}">${formatValue(params[key], schema)}</span>
      </div>
      <input type="range" class="form-slider" id="slider_${key}"
        min="${schema.min}" max="${schema.max}" step="${schema.step}"
        value="${params[key]}">
    `;
    
    const slider = group.querySelector(`#slider_${key}`);
    const valueEl = group.querySelector(`#value_${key}`);
    
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      state.currentConfig.params[key] = value;
      valueEl.textContent = formatValue(value, schema);
      notifyChange(state, options);
    });
    
    elements.parameterControls.appendChild(group);
  }
}

function renderColorControls(elements, state, options) {
  elements.colorControls.innerHTML = '';
  const params = state.currentConfig.params;
  
  const colorKeys = ['primaryColor', 'secondaryColor', 'tertiaryColor'];
  const labels = ['Primary', 'Secondary', 'Glow'];
  
  colorKeys.forEach((key, i) => {
    if (!params[key]) return;
    
    const group = document.createElement('div');
    group.className = 'form-group';
    group.innerHTML = `
      <div class="form-label">
        <span>${labels[i]} Color</span>
      </div>
      <input type="color" class="form-color" id="color_${key}" value="${rgbToHex(params[key])}">
    `;
    
    const input = group.querySelector(`#color_${key}`);
    input.addEventListener('input', (e) => {
      state.currentConfig.params[key] = hexToRgb(e.target.value);
      notifyChange(state, options);
    });
    
    elements.colorControls.appendChild(group);
  });
}

function renderStats(elements, state) {
  const stats = state.currentConfig.stats || {};
  elements.statsGrid.innerHTML = '';
  
  const displayStats = [
    { key: 'damage', label: 'Damage', format: v => v || '-' },
    { key: 'manaCost', label: 'Mana', format: v => v || '-' },
    { key: 'cooldown', label: 'Cooldown', format: v => v ? `${v}s` : '-' },
    { key: 'range', label: 'Range', format: v => v ? `${v}m` : 'Self' }
  ];
  
  for (const stat of displayStats) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-label">${stat.label}</div>
      <div class="stat-value">${stat.format(stats[stat.key])}</div>
    `;
    elements.statsGrid.appendChild(card);
  }
}

// ============================================================================
// SPELL OPERATIONS
// ============================================================================

function loadSpell(spellId, elements, state, options) {
  state.currentSpellId = spellId;
  state.currentConfig = cloneSpellConfig(spellId);
  state.currentCategory = state.currentConfig.category;
  updateUI(elements, state);
  notifyChange(state, options);
}

function saveSpell(state, options) {
  const book = getSpellBook();
  
  // Create custom spell
  const customSpell = {
    ...state.currentConfig,
    isCustom: true,
    customId: null, // Will be generated
    basePreset: state.currentSpellId
  };
  
  book.addSpell(customSpell);
  
  if (options.onSave) {
    options.onSave(customSpell);
  }
  
  // Show feedback
  alert(`Spell "${customSpell.name}" saved to Spell Book!`);
}

function exportSpell(state) {
  const json = JSON.stringify(state.currentConfig, null, 2);
  
  // Create download
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.currentConfig.name.replace(/\s+/g, '_').toLowerCase()}.spell.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function notifyChange(state, options) {
  if (options.onChange) {
    options.onChange(state.currentConfig);
  }
  
  // Generate emitter config for preview
  if (options.onEmitterUpdate) {
    const emitterConfig = createEmitterConfig(state.currentConfig);
    options.onEmitterUpdate(emitterConfig);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatValue(value, schema) {
  if (schema.type === 'slider') {
    return `${value}${schema.unit}`;
  }
  return value;
}

function destroyPanel(elements, state) {
  elements.panel.remove();
  state.listeners.clear();
}

export default initSpellBuilderPanel;
