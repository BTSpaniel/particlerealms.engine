// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spell Book Inspector Panel
 * 
 * Browse, manage, and organize saved spells.
 * Integrates with SpellBook for persistence.
 */

import { SPELL_CATEGORIES, rgbToHex } from './spell-configs/SpellConfig.js';
import { getSpellBook, initSpellBookWithPresets } from './spell-configs/SpellBook.js';

// ============================================================================
// PANEL INITIALIZATION
// ============================================================================

export function initSpellBookPanel(container, options = {}) {
  const book = initSpellBookWithPresets();
  
  const state = {
    selectedSpellId: null,
    filterCategory: 'all',
    searchQuery: '',
    viewMode: 'grid' // 'grid' or 'list'
  };
  
  const elements = createPanelDOM(container);
  setupEventListeners(elements, state, book, options);
  updateUI(elements, state, book);
  
  // Subscribe to spell book changes
  const unsubscribe = book.subscribe((event, data) => {
    updateUI(elements, state, book);
  });
  
  return {
    getState: () => ({ ...state }),
    getSelectedSpell: () => state.selectedSpellId ? book.getSpell(state.selectedSpellId) : null,
    selectSpell: (id) => { state.selectedSpellId = id; updateUI(elements, state, book); },
    refresh: () => updateUI(elements, state, book),
    destroy: () => {
      unsubscribe();
      elements.panel.remove();
    }
  };
}

// ============================================================================
// DOM CREATION
// ============================================================================

function createPanelDOM(container) {
  const panel = document.createElement('div');
  panel.className = 'spell-book-panel';
  panel.innerHTML = `
    <style>
      .spell-book-panel {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e4e4e7;
        background: #0a0a0f;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .spell-book-header {
        background: #0a0a0f;
        padding: 12px;
        border-bottom: 1px solid #1e1e2e;
      }
      
      .spell-book-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .spell-book-search {
        width: 100%;
        padding: 8px 12px;
        background: #0a0a0f;
        border: 1px solid #27272a;
        border-radius: 6px;
        color: white;
        font-size: 13px;
        margin-bottom: 8px;
      }
      
      .spell-book-search:focus {
        outline: none;
        border-color: #3b82f6;
      }
      
      .spell-book-filters {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      
      .filter-btn {
        padding: 4px 10px;
        background: #0f0f16;
        border: none;
        border-radius: 4px;
        color: #71717a;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }
      
      .filter-btn:hover {
        background: rgba(255,255,255,0.1);
        color: #e4e4e7;
      }
      
      .filter-btn.active {
        background: #3b82f6;
        color: white;
      }
      
      .spell-book-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      
      .spell-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 8px;
      }
      
      .spell-card {
        background: #0a0a0f;
        border: 2px solid #1e1e2e;
        border-radius: 8px;
        padding: 12px 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      
      .spell-card:hover {
        border-color: #2a2a3a;
        transform: translateY(-2px);
      }
      
      .spell-card.selected {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.15);
      }
      
      .spell-card-icon {
        font-size: 28px;
        margin-bottom: 4px;
      }
      
      .spell-card-name {
        font-size: 11px;
        color: #71717a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .spell-card-color {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid #27272a;
      }
      
      .spell-card-custom {
        position: absolute;
        top: 4px;
        left: 4px;
        font-size: 10px;
      }
      
      .spell-book-footer {
        background: #0a0a0f;
        padding: 12px;
        border-top: 1px solid #1e1e2e;
        display: flex;
        gap: 8px;
      }
      
      .footer-btn {
        flex: 1;
        padding: 8px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .footer-btn-primary {
        background: #3b82f6;
        color: white;
      }
      
      .footer-btn-primary:hover {
        background: #2563eb;
      }
      
      .footer-btn-secondary {
        background: #0f0f16;
        color: #e4e4e7;
      }
      
      .footer-btn-secondary:hover {
        background: rgba(255,255,255,0.1);
      }
      
      .footer-btn-danger {
        background: transparent;
        color: #ef4444;
        border: 1px solid #ef4444;
      }
      
      .footer-btn-danger:hover {
        background: rgba(239, 68, 68, 0.1);
      }
      
      .spell-detail {
        background: #0a0a0f;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        border: 1px solid #1e1e2e;
      }
      
      .spell-detail-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      
      .spell-detail-icon {
        font-size: 36px;
      }
      
      .spell-detail-info h3 {
        margin: 0 0 4px 0;
        font-size: 16px;
      }
      
      .spell-detail-info span {
        font-size: 12px;
        color: #52525b;
      }
      
      .spell-detail-stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      
      .detail-stat {
        background: #0f0f16;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 11px;
      }
      
      .detail-stat-label {
        color: #52525b;
      }
      
      .detail-stat-value {
        color: #f59e0b;
        font-weight: 600;
      }
      
      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #52525b;
      }
      
      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 12px;
      }
      
      .hotbar-section {
        margin-bottom: 16px;
      }
      
      .hotbar-title {
        font-size: 11px;
        font-weight: 600;
        color: #52525b;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      
      .hotbar-slots {
        display: flex;
        gap: 4px;
      }
      
      .hotbar-slot {
        width: 40px;
        height: 40px;
        background: #0a0a0f;
        border: 2px solid #1e1e2e;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .hotbar-slot:hover {
        border-color: #2a2a3a;
      }
      
      .hotbar-slot.filled {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.1);
      }
      
      .hotbar-slot-number {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 9px;
        color: #52525b;
      }
    </style>
    
    <div class="spell-book-header">
      <div class="spell-book-title">
        <span>📖</span>
        <span>Spell Book</span>
      </div>
      <input type="text" class="spell-book-search" id="searchInput" placeholder="Search spells...">
      <div class="spell-book-filters" id="filterButtons"></div>
    </div>
    
    <div class="spell-book-content">
      <div class="hotbar-section">
        <div class="hotbar-title">Quick Slots</div>
        <div class="hotbar-slots" id="hotbarSlots"></div>
      </div>
      
      <div id="spellDetail" style="display: none;"></div>
      
      <div class="spell-grid" id="spellGrid"></div>
      
      <div class="empty-state" id="emptyState" style="display: none;">
        <div class="empty-state-icon">📚</div>
        <div>No spells found</div>
        <div style="font-size: 12px; margin-top: 4px;">Create spells in the Spell Builder</div>
      </div>
    </div>
    
    <div class="spell-book-footer">
      <button class="footer-btn footer-btn-primary" id="editBtn">✏️ Edit</button>
      <button class="footer-btn footer-btn-secondary" id="importBtn">📥 Import</button>
      <button class="footer-btn footer-btn-danger" id="deleteBtn">🗑️</button>
    </div>
  `;
  
  container.appendChild(panel);
  
  return {
    panel,
    searchInput: panel.querySelector('#searchInput'),
    filterButtons: panel.querySelector('#filterButtons'),
    hotbarSlots: panel.querySelector('#hotbarSlots'),
    spellGrid: panel.querySelector('#spellGrid'),
    spellDetail: panel.querySelector('#spellDetail'),
    emptyState: panel.querySelector('#emptyState'),
    editBtn: panel.querySelector('#editBtn'),
    importBtn: panel.querySelector('#importBtn'),
    deleteBtn: panel.querySelector('#deleteBtn')
  };
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners(elements, state, book, options) {
  // Search
  elements.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    updateUI(elements, state, book);
  });
  
  // Filter buttons
  elements.filterButtons.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      state.filterCategory = e.target.dataset.category;
      updateUI(elements, state, book);
    }
  });
  
  // Spell grid
  elements.spellGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.spell-card');
    if (card) {
      state.selectedSpellId = card.dataset.spellId;
      updateUI(elements, state, book);
      
      if (options.onSelect) {
        options.onSelect(book.getSpell(state.selectedSpellId));
      }
    }
  });
  
  // Hotbar slots
  elements.hotbarSlots.addEventListener('click', (e) => {
    const slot = e.target.closest('.hotbar-slot');
    if (slot && state.selectedSpellId) {
      const slotIndex = parseInt(slot.dataset.slot);
      book.assignToHotbar(slotIndex, state.selectedSpellId);
    }
  });
  
  // Edit button
  elements.editBtn.addEventListener('click', () => {
    if (state.selectedSpellId && options.onEdit) {
      options.onEdit(book.getSpell(state.selectedSpellId));
    }
  });
  
  // Import button
  elements.importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.spell.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = book.importFromJSON(event.target.result);
          if (result.success) {
            alert(`Imported ${result.count} spell(s)!`);
          } else {
            alert(`Import failed: ${result.error}`);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  });
  
  // Delete button
  elements.deleteBtn.addEventListener('click', () => {
    if (state.selectedSpellId) {
      const spell = book.getSpell(state.selectedSpellId);
      if (spell && !spell.isPreset) {
        if (confirm(`Delete spell "${spell.name}"?`)) {
          book.removeSpell(state.selectedSpellId);
          state.selectedSpellId = null;
        }
      } else if (spell && spell.isPreset) {
        alert('Cannot delete preset spells');
      }
    }
  });
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateUI(elements, state, book) {
  renderFilterButtons(elements, state);
  renderHotbar(elements, book);
  renderSpellGrid(elements, state, book);
  renderSpellDetail(elements, state, book);
}

function renderFilterButtons(elements, state) {
  elements.filterButtons.innerHTML = '';
  
  // All filter
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-btn' + (state.filterCategory === 'all' ? ' active' : '');
  allBtn.dataset.category = 'all';
  allBtn.textContent = 'All';
  elements.filterButtons.appendChild(allBtn);
  
  // Category filters
  for (const [id, cat] of Object.entries(SPELL_CATEGORIES)) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (state.filterCategory === id ? ' active' : '');
    btn.dataset.category = id;
    btn.textContent = cat.icon;
    btn.title = cat.name;
    elements.filterButtons.appendChild(btn);
  }
}

function renderHotbar(elements, book) {
  elements.hotbarSlots.innerHTML = '';
  const hotbar = book.getHotbar();
  
  for (const { slot, spell } of hotbar) {
    const slotEl = document.createElement('div');
    slotEl.className = 'hotbar-slot' + (spell ? ' filled' : '');
    slotEl.dataset.slot = slot;
    slotEl.innerHTML = spell ? spell.icon : '';
    slotEl.title = spell ? spell.name : `Slot ${slot + 1} (empty)`;
    elements.hotbarSlots.appendChild(slotEl);
  }
}

function renderSpellGrid(elements, state, book) {
  let spells = book.getAllSpells();
  
  // Apply category filter
  if (state.filterCategory !== 'all') {
    spells = spells.filter(s => s.category === state.filterCategory);
  }
  
  // Apply search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    spells = spells.filter(s => 
      s.name.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  }
  
  // Show/hide empty state
  elements.emptyState.style.display = spells.length === 0 ? 'block' : 'none';
  elements.spellGrid.style.display = spells.length === 0 ? 'none' : 'grid';
  
  // Render spell cards
  elements.spellGrid.innerHTML = '';
  
  for (const spell of spells) {
    const card = document.createElement('div');
    card.className = 'spell-card' + (spell.customId === state.selectedSpellId ? ' selected' : '');
    card.dataset.spellId = spell.customId || spell.id;
    
    const primaryColor = spell.params?.primaryColor || [1, 1, 1];
    
    card.innerHTML = `
      ${spell.isCustom ? '<div class="spell-card-custom">✨</div>' : ''}
      <div class="spell-card-color" style="background: ${rgbToHex(primaryColor)}"></div>
      <div class="spell-card-icon">${spell.icon}</div>
      <div class="spell-card-name">${spell.name}</div>
    `;
    
    elements.spellGrid.appendChild(card);
  }
}

function renderSpellDetail(elements, state, book) {
  if (!state.selectedSpellId) {
    elements.spellDetail.style.display = 'none';
    return;
  }
  
  const spell = book.getSpell(state.selectedSpellId);
  if (!spell) {
    elements.spellDetail.style.display = 'none';
    return;
  }
  
  elements.spellDetail.style.display = 'block';
  
  const stats = spell.stats || {};
  const category = SPELL_CATEGORIES[spell.category] || { name: 'Unknown', icon: '❓' };
  
  elements.spellDetail.innerHTML = `
    <div class="spell-detail-header">
      <div class="spell-detail-icon">${spell.icon}</div>
      <div class="spell-detail-info">
        <h3>${spell.name}</h3>
        <span>${category.icon} ${category.name} • ${spell.isCustom ? 'Custom' : 'Preset'}</span>
      </div>
    </div>
    <div class="spell-detail-stats">
      ${stats.damage ? `<div class="detail-stat"><span class="detail-stat-label">Damage:</span> <span class="detail-stat-value">${stats.damage}</span></div>` : ''}
      ${stats.healAmount ? `<div class="detail-stat"><span class="detail-stat-label">Heal:</span> <span class="detail-stat-value">${stats.healAmount}</span></div>` : ''}
      ${stats.manaCost ? `<div class="detail-stat"><span class="detail-stat-label">Mana:</span> <span class="detail-stat-value">${stats.manaCost}</span></div>` : ''}
      ${stats.cooldown ? `<div class="detail-stat"><span class="detail-stat-label">Cooldown:</span> <span class="detail-stat-value">${stats.cooldown}s</span></div>` : ''}
      ${stats.range ? `<div class="detail-stat"><span class="detail-stat-label">Range:</span> <span class="detail-stat-value">${stats.range}m</span></div>` : ''}
      ${stats.duration ? `<div class="detail-stat"><span class="detail-stat-label">Duration:</span> <span class="detail-stat-value">${stats.duration}s</span></div>` : ''}
    </div>
  `;
}

export default initSpellBookPanel;
