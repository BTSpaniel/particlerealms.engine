// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AILoot.js - Loot Generation and Drop System
 * 
 * Features:
 * - Procedural loot generation
 * - Rarity tiers and weighting
 * - Loot tables and pools
 * - Context-aware drops (enemy type, location, etc.)
 * - Item affixes and modifiers
 * - Treasure/chest systems
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Rarity tiers */
export const RARITY = {
  COMMON: "common",
  UNCOMMON: "uncommon",
  RARE: "rare",
  EPIC: "epic",
  LEGENDARY: "legendary",
  MYTHIC: "mythic",
};

/** Rarity weights (higher = more common) */
const RARITY_WEIGHTS = {
  [RARITY.COMMON]: 100,
  [RARITY.UNCOMMON]: 40,
  [RARITY.RARE]: 15,
  [RARITY.EPIC]: 5,
  [RARITY.LEGENDARY]: 1,
  [RARITY.MYTHIC]: 0.1,
};

/** Rarity color codes */
export const RARITY_COLORS = {
  [RARITY.COMMON]: "#9d9d9d",
  [RARITY.UNCOMMON]: "#1eff00",
  [RARITY.RARE]: "#0070dd",
  [RARITY.EPIC]: "#a335ee",
  [RARITY.LEGENDARY]: "#ff8000",
  [RARITY.MYTHIC]: "#e6cc80",
};

/** Item categories */
export const ITEM_CATEGORY = {
  WEAPON: "weapon",
  ARMOR: "armor",
  CONSUMABLE: "consumable",
  MATERIAL: "material",
  QUEST: "quest",
  CURRENCY: "currency",
  MISC: "misc",
};

// ============================================================================
// ITEM DEFINITION
// ============================================================================

/**
 * Create item definition
 * @param {Object} config - Item config
 * @returns {Object} Item definition
 */
export function createItemDef(config) {
  return {
    id: config.id,
    name: config.name,
    description: config.description || "",
    
    // Classification
    category: config.category || ITEM_CATEGORY.MISC,
    subCategory: config.subCategory || null,
    rarity: config.rarity || RARITY.COMMON,
    
    // Stats
    baseStats: config.baseStats || {},
    
    // Requirements
    levelRequired: config.levelRequired || 1,
    classRequired: config.classRequired || null,
    
    // Value
    baseValue: config.baseValue || 1,
    
    // Visual
    icon: config.icon || null,
    model: config.model || null,
    
    // Stacking
    stackable: config.stackable ?? false,
    maxStack: config.maxStack || 99,
    
    // Flags
    sellable: config.sellable ?? true,
    tradeable: config.tradeable ?? true,
    destroyable: config.destroyable ?? true,
    
    // For equipment
    slot: config.slot || null,
    
    // Tags for filtering
    tags: config.tags || [],
  };
}

// ============================================================================
// ITEM INSTANCE
// ============================================================================

/**
 * Create item instance from definition
 * @param {Object} itemDef - Item definition
 * @param {Object} options - Instance options
 * @returns {Object} Item instance
 */
export function createItemInstance(itemDef, options = {}) {
  const instance = {
    id: aiRng.uniqueId('item'),
    defId: itemDef.id,
    def: itemDef,
    
    // Stack
    quantity: options.quantity ?? 1,
    
    // Overrides
    rarity: options.rarity || itemDef.rarity,
    
    // Generated stats (from affixes)
    stats: { ...itemDef.baseStats },
    
    // Affixes
    prefixes: [],
    suffixes: [],
    
    // Item level (affects stat rolls)
    itemLevel: options.itemLevel || 1,
    
    // Value (modified by rarity and affixes)
    value: itemDef.baseValue,
    
    // Soulbound, etc.
    bound: options.bound ?? false,
    boundTo: null,
  };
  
  // Apply rarity multiplier to stats
  const rarityMultiplier = getRarityStatMultiplier(instance.rarity);
  for (const stat in instance.stats) {
    instance.stats[stat] = Math.round(instance.stats[stat] * rarityMultiplier);
  }
  
  // Update value
  instance.value = Math.round(itemDef.baseValue * rarityMultiplier * (1 + instance.itemLevel * 0.1));
  
  return instance;
}

/**
 * Get stat multiplier for rarity
 */
function getRarityStatMultiplier(rarity) {
  const multipliers = {
    [RARITY.COMMON]: 1.0,
    [RARITY.UNCOMMON]: 1.15,
    [RARITY.RARE]: 1.3,
    [RARITY.EPIC]: 1.5,
    [RARITY.LEGENDARY]: 1.8,
    [RARITY.MYTHIC]: 2.2,
  };
  return multipliers[rarity] || 1.0;
}

// ============================================================================
// AFFIXES
// ============================================================================

/**
 * Create affix definition
 * @param {Object} config - Affix config
 * @returns {Object} Affix
 */
export function createAffix(config) {
  return {
    id: config.id,
    name: config.name,
    type: config.type || "prefix", // prefix or suffix
    
    // What items can have this
    validCategories: config.validCategories || [ITEM_CATEGORY.WEAPON, ITEM_CATEGORY.ARMOR],
    validSlots: config.validSlots || null,
    minRarity: config.minRarity || RARITY.UNCOMMON,
    
    // Stat modifications
    statMods: config.statMods || {}, // {stat: {min, max}} or {stat: value}
    
    // Weight for rolling
    weight: config.weight || 100,
    
    // Level requirement addition
    levelReqAdd: config.levelReqAdd || 0,
    
    // Value multiplier
    valueMult: config.valueMult || 1.1,
  };
}

/**
 * Apply affix to item
 * @param {Object} item - Item instance
 * @param {Object} affix - Affix definition
 * @returns {boolean} Success
 */
export function applyAffix(item, affix) {
  // Check validity
  if (!affix.validCategories.includes(item.def.category)) return false;
  if (affix.validSlots && !affix.validSlots.includes(item.def.slot)) return false;
  if (RARITY_ORDER.indexOf(item.rarity) < RARITY_ORDER.indexOf(affix.minRarity)) return false;
  
  // Check limits
  const maxAffixes = getMaxAffixes(item.rarity);
  if (affix.type === "prefix" && item.prefixes.length >= maxAffixes.prefixes) return false;
  if (affix.type === "suffix" && item.suffixes.length >= maxAffixes.suffixes) return false;
  
  // Roll stats
  for (const [stat, mod] of Object.entries(affix.statMods)) {
    let value;
    if (typeof mod === "object" && mod.min !== undefined) {
      // Random range
      value = aiRng.range(mod.min, mod.max);
      value = Math.round(value * (1 + item.itemLevel * 0.05));
    } else {
      value = mod;
    }
    
    item.stats[stat] = (item.stats[stat] || 0) + value;
  }
  
  // Add affix
  if (affix.type === "prefix") {
    item.prefixes.push({ id: affix.id, name: affix.name });
  } else {
    item.suffixes.push({ id: affix.id, name: affix.name });
  }
  
  // Update value
  item.value = Math.round(item.value * affix.valueMult);
  
  return true;
}

const RARITY_ORDER = [RARITY.COMMON, RARITY.UNCOMMON, RARITY.RARE, RARITY.EPIC, RARITY.LEGENDARY, RARITY.MYTHIC];

function getMaxAffixes(rarity) {
  const max = {
    [RARITY.COMMON]: { prefixes: 0, suffixes: 0 },
    [RARITY.UNCOMMON]: { prefixes: 1, suffixes: 0 },
    [RARITY.RARE]: { prefixes: 1, suffixes: 1 },
    [RARITY.EPIC]: { prefixes: 2, suffixes: 1 },
    [RARITY.LEGENDARY]: { prefixes: 2, suffixes: 2 },
    [RARITY.MYTHIC]: { prefixes: 3, suffixes: 3 },
  };
  return max[rarity] || max[RARITY.COMMON];
}

/**
 * Generate item name from affixes
 * @param {Object} item - Item instance
 * @returns {string} Generated name
 */
export function generateItemName(item) {
  let name = item.def.name;
  
  if (item.prefixes.length > 0) {
    name = item.prefixes.map(p => p.name).join(" ") + " " + name;
  }
  
  if (item.suffixes.length > 0) {
    name = name + " of " + item.suffixes.map(s => s.name).join(" and ");
  }
  
  return name;
}

// ============================================================================
// LOOT TABLES
// ============================================================================

/**
 * Create loot table entry
 * @param {Object} config - Entry config
 * @returns {Object} Loot entry
 */
export function createLootEntry(config) {
  return {
    itemId: config.itemId,
    weight: config.weight || 100,
    minQuantity: config.minQuantity || 1,
    maxQuantity: config.maxQuantity || 1,
    
    // Optional overrides
    rarity: config.rarity || null,       // Force rarity
    rarityBoost: config.rarityBoost || 0, // Add to rarity roll
    
    // Conditions
    minLevel: config.minLevel || 0,
    maxLevel: config.maxLevel || Infinity,
    conditions: config.conditions || null, // Custom function
  };
}

/**
 * Create loot table
 * @param {Object} config - Table config
 * @returns {Object} Loot table
 */
export function createLootTable(config) {
  return {
    id: config.id,
    name: config.name || config.id,
    
    // Entries
    entries: config.entries || [],
    
    // Roll settings
    guaranteedDrops: config.guaranteedDrops || 0,
    bonusDropChance: config.bonusDropChance || 0, // Chance for extra drops
    maxDrops: config.maxDrops || 5,
    
    // Rarity modifiers
    rarityBonus: config.rarityBonus || 0,
    
    // Nested tables (for complex drops)
    subTables: config.subTables || [], // [{tableId, weight, rolls}]
  };
}

/**
 * Roll loot from table
 * @param {Object} table - Loot table
 * @param {Object} itemDefs - Map of item definitions
 * @param {Object} context - Context {level, luck, conditions}
 * @returns {Array<Object>} Dropped items
 */
export function rollLootTable(table, itemDefs, context = {}) {
  const drops = [];
  const level = context.level || 1;
  const luck = context.luck || 0;
  
  // Filter valid entries
  const validEntries = table.entries.filter(entry => {
    if (level < entry.minLevel || level > entry.maxLevel) return false;
    if (entry.conditions && !entry.conditions(context)) return false;
    return true;
  });
  
  if (validEntries.length === 0) return drops;
  
  // Calculate total weight
  const totalWeight = validEntries.reduce((sum, e) => sum + e.weight, 0);
  
  // Guaranteed drops
  let dropCount = table.guaranteedDrops;
  
  // Bonus drop chances
  while (drops.length < table.maxDrops && aiRng.chance(table.bonusDropChance)) {
    dropCount++;
  }
  
  // Roll drops
  for (let i = 0; i < dropCount && drops.length < table.maxDrops; i++) {
    let roll = aiRng.float() * totalWeight;
    
    for (const entry of validEntries) {
      roll -= entry.weight;
      if (roll <= 0) {
        // Get item definition
        const def = itemDefs.get(entry.itemId);
        if (!def) break;
        
        // Determine rarity
        let rarity = entry.rarity || rollRarity(table.rarityBonus + entry.rarityBoost + luck);
        
        // Roll quantity
        const quantity = aiRng.intRange(entry.minQuantity, entry.maxQuantity);
        
        // Create item
        const item = createItemInstance(def, {
          quantity,
          rarity,
          itemLevel: level,
        });
        
        drops.push(item);
        break;
      }
    }
  }
  
  // Roll sub-tables
  for (const sub of table.subTables) {
    if (aiRng.chance(sub.weight / 100)) {
      const subTable = context.tables?.get(sub.tableId);
      if (subTable) {
        const subDrops = rollLootTable(subTable, itemDefs, context);
        drops.push(...subDrops);
      }
    }
  }
  
  return drops;
}

/**
 * Roll rarity based on luck
 * @param {number} luckBonus - Luck bonus
 * @returns {string} Rarity
 */
export function rollRarity(luckBonus = 0) {
  // Modify weights by luck
  const weights = { ...RARITY_WEIGHTS };
  weights[RARITY.COMMON] *= Math.max(0.1, 1 - luckBonus * 0.1);
  weights[RARITY.RARE] *= (1 + luckBonus * 0.2);
  weights[RARITY.EPIC] *= (1 + luckBonus * 0.3);
  weights[RARITY.LEGENDARY] *= (1 + luckBonus * 0.4);
  weights[RARITY.MYTHIC] *= (1 + luckBonus * 0.5);
  
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = aiRng.float() * total;
  
  for (const [rarity, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  
  return RARITY.COMMON;
}

// ============================================================================
// LOOT MANAGER
// ============================================================================

/**
 * Create loot manager
 * @returns {Object} Loot manager
 */
export function createLootManager() {
  return {
    itemDefs: new Map(),
    affixDefs: new Map(),
    lootTables: new Map(),
    
    // World drops
    droppedItems: new Map(), // id → {item, position, timestamp}
    
    // Configuration
    dropLifetime: 300000, // 5 minutes
  };
}

/**
 * Register item definition
 * @param {Object} manager - Loot manager
 * @param {Object} itemDef - Item definition
 */
export function registerItemDef(manager, itemDef) {
  manager.itemDefs.set(itemDef.id, itemDef);
}

/**
 * Register affix
 * @param {Object} manager - Loot manager
 * @param {Object} affix - Affix definition
 */
export function registerAffix(manager, affix) {
  manager.affixDefs.set(affix.id, affix);
}

/**
 * Register loot table
 * @param {Object} manager - Loot manager
 * @param {Object} table - Loot table
 */
export function registerLootTable(manager, table) {
  manager.lootTables.set(table.id, table);
}

/**
 * Drop loot at position
 * @param {Object} manager - Loot manager
 * @param {string} tableId - Loot table ID
 * @param {number[]} position - World position
 * @param {Object} context - Drop context
 * @returns {Array} Dropped items
 */
export function dropLoot(manager, tableId, position, context = {}) {
  const table = manager.lootTables.get(tableId);
  if (!table) return [];
  
  context.tables = manager.lootTables;
  const items = rollLootTable(table, manager.itemDefs, context);
  
  // Apply affixes based on rarity
  for (const item of items) {
    applyRandomAffixes(manager, item);
  }
  
  // Create world drops
  for (let i = 0; i < items.length; i++) {
    const offset = [aiRng.range(-1, 1), 0, aiRng.range(-1, 1)];
    const dropPos = [position[0] + offset[0], position[1], position[2] + offset[2]];
    
    const dropId = aiRng.uniqueId('drop');
    manager.droppedItems.set(dropId, {
      item: items[i],
      position: dropPos,
      timestamp: performance.now(),
    });
  }
  
  return items;
}

/**
 * Apply random affixes to item based on rarity
 */
function applyRandomAffixes(manager, item) {
  const maxAffixes = getMaxAffixes(item.rarity);
  const validAffixes = Array.from(manager.affixDefs.values()).filter(a =>
    a.validCategories.includes(item.def.category) &&
    RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.indexOf(a.minRarity)
  );
  
  const prefixes = validAffixes.filter(a => a.type === "prefix");
  const suffixes = validAffixes.filter(a => a.type === "suffix");
  
  // Roll prefixes
  for (let i = 0; i < maxAffixes.prefixes && prefixes.length > 0; i++) {
    const totalWeight = prefixes.reduce((sum, a) => sum + a.weight, 0);
    let roll = aiRng.float() * totalWeight;
    
    for (let j = 0; j < prefixes.length; j++) {
      roll -= prefixes[j].weight;
      if (roll <= 0) {
        applyAffix(item, prefixes[j]);
        prefixes.splice(j, 1); // Remove to prevent duplicates
        break;
      }
    }
  }
  
  // Roll suffixes
  for (let i = 0; i < maxAffixes.suffixes && suffixes.length > 0; i++) {
    const totalWeight = suffixes.reduce((sum, a) => sum + a.weight, 0);
    let roll = aiRng.float() * totalWeight;
    
    for (let j = 0; j < suffixes.length; j++) {
      roll -= suffixes[j].weight;
      if (roll <= 0) {
        applyAffix(item, suffixes[j]);
        suffixes.splice(j, 1);
        break;
      }
    }
  }
}

/**
 * Clean up expired drops
 * @param {Object} manager - Loot manager
 */
export function cleanupDrops(manager) {
  const now = performance.now();
  
  for (const [id, drop] of manager.droppedItems) {
    if (now - drop.timestamp > manager.dropLifetime) {
      manager.droppedItems.delete(id);
    }
  }
}
