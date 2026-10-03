// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { aiRng } from './AIRandom.js';

/**
 * AIEconomy.js - Economic Simulation System
 * 
 * Features:
 * - Supply and demand pricing
 * - Resource production and consumption
 * - Trading between entities/settlements
 * - Crafting and manufacturing
 * - Currency and wealth tracking
 * - Market fluctuations
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Resource categories */
export const RESOURCE_CATEGORY = {
  RAW: "raw",           // Iron ore, wood, wheat
  REFINED: "refined",   // Iron ingots, lumber, flour
  CRAFTED: "crafted",   // Weapons, furniture, bread
  LUXURY: "luxury",     // Gems, wine, art
  SERVICE: "service",   // Labor, transport
};

/** Market trend directions */
export const MARKET_TREND = {
  CRASHING: -2,
  FALLING: -1,
  STABLE: 0,
  RISING: 1,
  BOOMING: 2,
};

// ============================================================================
// RESOURCE DEFINITION
// ============================================================================

/**
 * Create resource definition
 * @param {Object} config - Resource config
 * @returns {Object} Resource definition
 */
export function createResource(config) {
  return {
    id: config.id,
    name: config.name,
    category: config.category || RESOURCE_CATEGORY.RAW,
    
    // Base economic values
    basePrice: config.basePrice || 10,
    weight: config.weight || 1,        // Per unit
    stackSize: config.stackSize || 100,
    
    // Production
    productionTime: config.productionTime || 1, // Hours
    productionInputs: config.productionInputs || [], // [{resourceId, amount}]
    productionOutput: config.productionOutput || 1,
    
    // Consumption
    isConsumable: config.isConsumable ?? false,
    consumptionRate: config.consumptionRate || 0, // Per day per capita
    
    // Properties
    perishable: config.perishable ?? false,
    perishTime: config.perishTime || 0, // Hours until spoiled
    
    // Tags
    tags: config.tags || [],
  };
}

// ============================================================================
// MARKET
// ============================================================================

/**
 * Create a market (trading location)
 * @param {Object} config - Market config
 * @returns {Object} Market
 */
export function createMarket(config = {}) {
  return {
    id: config.id || aiRng.uniqueId('market'),
    name: config.name || "Market",
    location: config.location || null,
    
    // Price data: resourceId → {price, supply, demand, trend, history}
    prices: new Map(),
    
    // Inventory available for trade
    inventory: new Map(), // resourceId → quantity
    
    // Configuration
    priceVolatility: config.priceVolatility ?? 0.1, // How much prices can change
    taxRate: config.taxRate ?? 0.05,
    
    // Trading history
    transactions: [],
    maxTransactionHistory: config.maxTransactionHistory || 100,
  };
}

/**
 * Initialize resource in market
 * @param {Object} market - Market
 * @param {Object} resource - Resource definition
 * @param {number} initialSupply - Initial supply
 * @param {number} baseDemand - Base demand per day
 */
export function initMarketResource(market, resource, initialSupply = 100, baseDemand = 10) {
  market.prices.set(resource.id, {
    currentPrice: resource.basePrice,
    basePrice: resource.basePrice,
    supply: initialSupply,
    demand: baseDemand,
    trend: MARKET_TREND.STABLE,
    history: [resource.basePrice],
  });
  
  market.inventory.set(resource.id, initialSupply);
}

/**
 * Calculate current price based on supply/demand
 * @param {Object} market - Market
 * @param {string} resourceId - Resource ID
 * @returns {number} Current price
 */
export function calculatePrice(market, resourceId) {
  const data = market.prices.get(resourceId);
  if (!data) return 0;
  
  // Price = basePrice * (demand / supply) with bounds
  const supplyDemandRatio = data.supply > 0 ? data.demand / data.supply : 10;
  const multiplier = Math.max(0.1, Math.min(10, supplyDemandRatio));
  
  return Math.round(data.basePrice * multiplier * 100) / 100;
}

/**
 * Update market prices
 * @param {Object} market - Market
 * @param {number} deltaHours - Hours elapsed
 */
export function updateMarketPrices(market, deltaHours) {
  for (const [resourceId, data] of market.prices) {
    const oldPrice = data.currentPrice;
    const newPrice = calculatePrice(market, resourceId);
    
    // Apply volatility-limited change
    const maxChange = oldPrice * market.priceVolatility * (deltaHours / 24);
    const actualChange = Math.max(-maxChange, Math.min(maxChange, newPrice - oldPrice));
    
    data.currentPrice = Math.max(0.01, oldPrice + actualChange);
    
    // Update trend
    if (actualChange > oldPrice * 0.05) {
      data.trend = actualChange > oldPrice * 0.1 ? MARKET_TREND.BOOMING : MARKET_TREND.RISING;
    } else if (actualChange < -oldPrice * 0.05) {
      data.trend = actualChange < -oldPrice * 0.1 ? MARKET_TREND.CRASHING : MARKET_TREND.FALLING;
    } else {
      data.trend = MARKET_TREND.STABLE;
    }
    
    // Record history
    data.history.push(data.currentPrice);
    if (data.history.length > 30) data.history.shift();
  }
}

/**
 * Execute a buy transaction
 * @param {Object} market - Market
 * @param {string} resourceId - Resource ID
 * @param {number} quantity - Quantity to buy
 * @param {Object} buyer - Buyer {id, gold}
 * @returns {{success: boolean, cost: number, quantity: number}}
 */
export function buyFromMarket(market, resourceId, quantity, buyer) {
  const data = market.prices.get(resourceId);
  const available = market.inventory.get(resourceId) || 0;
  
  if (!data || available <= 0) {
    return { success: false, cost: 0, quantity: 0 };
  }
  
  const actualQuantity = Math.min(quantity, available);
  const unitPrice = data.currentPrice * (1 + market.taxRate);
  const totalCost = Math.ceil(unitPrice * actualQuantity);
  
  if (buyer.gold < totalCost) {
    // Buy what we can afford
    const affordable = Math.floor(buyer.gold / unitPrice);
    if (affordable <= 0) {
      return { success: false, cost: 0, quantity: 0 };
    }
    return buyFromMarket(market, resourceId, affordable, buyer);
  }
  
  // Execute transaction
  buyer.gold -= totalCost;
  market.inventory.set(resourceId, available - actualQuantity);
  data.supply -= actualQuantity;
  data.demand += actualQuantity * 0.1; // Buying increases apparent demand
  
  // Record transaction
  market.transactions.push({
    type: "buy",
    resourceId,
    quantity: actualQuantity,
    price: unitPrice,
    total: totalCost,
    buyerId: buyer.id,
    timestamp: performance.now(), // Use performance.now() for timestamp
  });
  
  if (market.transactions.length > market.maxTransactionHistory) {
    market.transactions.shift();
  }
  
  return { success: true, cost: totalCost, quantity: actualQuantity };
}

/**
 * Execute a sell transaction
 * @param {Object} market - Market
 * @param {string} resourceId - Resource ID
 * @param {number} quantity - Quantity to sell
 * @param {Object} seller - Seller {id, gold}
 * @returns {{success: boolean, revenue: number, quantity: number}}
 */
export function sellToMarket(market, resourceId, quantity, seller) {
  const data = market.prices.get(resourceId);
  
  if (!data) {
    return { success: false, revenue: 0, quantity: 0 };
  }
  
  const unitPrice = data.currentPrice * (1 - market.taxRate);
  const totalRevenue = Math.floor(unitPrice * quantity);
  
  // Execute transaction
  seller.gold += totalRevenue;
  const current = market.inventory.get(resourceId) || 0;
  market.inventory.set(resourceId, current + quantity);
  data.supply += quantity;
  data.demand -= quantity * 0.1; // Selling decreases apparent demand
  data.demand = Math.max(1, data.demand);
  
  // Record transaction
  market.transactions.push({
    type: "sell",
    resourceId,
    quantity,
    price: unitPrice,
    total: totalRevenue,
    sellerId: seller.id,
    timestamp: performance.now(), // Use performance.now() for timestamp
  });
  
  if (market.transactions.length > market.maxTransactionHistory) {
    market.transactions.shift();
  }
  
  return { success: true, revenue: totalRevenue, quantity };
}

// ============================================================================
// INVENTORY
// ============================================================================

/**
 * Create inventory
 * @param {number} capacity - Max weight capacity
 * @returns {Object} Inventory
 */
export function createInventory(capacity = 100) {
  return {
    items: new Map(), // resourceId → quantity
    capacity,
    currentWeight: 0,
  };
}

/**
 * Add items to inventory
 * @param {Object} inventory - Inventory
 * @param {string} resourceId - Resource ID
 * @param {number} quantity - Quantity to add
 * @param {Object} resourceDef - Resource definition
 * @returns {number} Quantity actually added
 */
export function addToInventory(inventory, resourceId, quantity, resourceDef) {
  const itemWeight = resourceDef.weight * quantity;
  const availableCapacity = inventory.capacity - inventory.currentWeight;
  const maxCanAdd = Math.floor(availableCapacity / resourceDef.weight);
  const actualAdd = Math.min(quantity, maxCanAdd);
  
  if (actualAdd <= 0) return 0;
  
  const current = inventory.items.get(resourceId) || 0;
  inventory.items.set(resourceId, current + actualAdd);
  inventory.currentWeight += actualAdd * resourceDef.weight;
  
  return actualAdd;
}

/**
 * Remove items from inventory
 * @param {Object} inventory - Inventory
 * @param {string} resourceId - Resource ID
 * @param {number} quantity - Quantity to remove
 * @param {Object} resourceDef - Resource definition
 * @returns {number} Quantity actually removed
 */
export function removeFromInventory(inventory, resourceId, quantity, resourceDef) {
  const current = inventory.items.get(resourceId) || 0;
  const actualRemove = Math.min(quantity, current);
  
  if (actualRemove <= 0) return 0;
  
  inventory.items.set(resourceId, current - actualRemove);
  inventory.currentWeight -= actualRemove * resourceDef.weight;
  
  if (inventory.items.get(resourceId) <= 0) {
    inventory.items.delete(resourceId);
  }
  
  return actualRemove;
}

// ============================================================================
// CRAFTING
// ============================================================================

/**
 * Create crafting recipe
 * @param {Object} config - Recipe config
 * @returns {Object} Recipe
 */
export function createRecipe(config) {
  return {
    id: config.id,
    name: config.name,
    
    // Inputs required
    inputs: config.inputs || [], // [{resourceId, amount}]
    
    // Output produced
    output: {
      resourceId: config.outputResourceId,
      amount: config.outputAmount || 1,
    },
    
    // Requirements
    craftingTime: config.craftingTime || 1, // Hours
    requiredSkill: config.requiredSkill || null,
    requiredSkillLevel: config.requiredSkillLevel || 0,
    requiredStation: config.requiredStation || null, // Tool/workbench needed
    
    // Skill gain
    skillGain: config.skillGain || 0.1,
  };
}

/**
 * Check if can craft recipe
 * @param {Object} recipe - Recipe
 * @param {Object} inventory - Crafter's inventory
 * @param {Object} skills - Crafter's skills {skillName: level}
 * @param {Object} context - Optional explicit station (ID or {id,type})
 * @returns {{canCraft: boolean, missing: Array}}
 */
export function canCraft(recipe, inventory, skills = {}, context = {}) {
  const missing = [];

  if (!recipe || !Array.isArray(recipe.inputs) || !recipe.output
      || typeof recipe.output.resourceId !== 'string' || !Number.isFinite(recipe.output.amount)
      || recipe.output.amount <= 0 || !(inventory?.items instanceof Map)) {
    return { canCraft: false, missing: [{ type: 'recipe', reason: 'Invalid recipe or inventory' }] };
  }
  const station = context.station;
  if (recipe.requiredStation && ![station, station?.id, station?.type].includes(recipe.requiredStation)) {
    missing.push({ type: 'station', required: recipe.requiredStation });
  }
  
  // Check skill
  if (recipe.requiredSkill) {
    const skillLevel = skills[recipe.requiredSkill] || 0;
    if (skillLevel < recipe.requiredSkillLevel) {
      missing.push({ type: "skill", skill: recipe.requiredSkill, required: recipe.requiredSkillLevel, have: skillLevel });
    }
  }
  
  // Check materials
  const required = new Map();
  for (const input of recipe.inputs) {
    if (typeof input?.resourceId !== 'string' || !Number.isFinite(input.amount) || input.amount <= 0) {
      missing.push({ type: 'recipe', reason: 'Inputs require positive finite quantities' });
      continue;
    }
    required.set(input.resourceId, (required.get(input.resourceId) || 0) + input.amount);
  }
  for (const [resourceId, amount] of required) {
    const have = inventory.items.get(resourceId) || 0;
    if (!Number.isFinite(have) || have < amount) {
      missing.push({ type: "material", resourceId, required: amount, have });
    }
  }
  
  return { canCraft: missing.length === 0, missing };
}

/**
 * Execute crafting
 * @param {Object} recipe - Recipe
 * @param {Object} inventory - Crafter's inventory
 * @param {Object} resourceDefs - Map of resource definitions
 * @param {Object} skills - Crafter's skills (will be modified)
 * @param {Object} context - Optional station and distinct outputInventory
 * @returns {{success: boolean, message: string}}
 */
export function craft(recipe, inventory, resourceDefs, skills = {}, context = {}) {
  const { canCraft: able, missing } = canCraft(recipe, inventory, skills, context);
  
  if (!able) {
    return { success: false, message: "Missing requirements", missing };
  }
  
  // Stage both inventories. A failed requirement or capacity check changes neither.
  const destination = context.outputInventory || inventory;
  if (destination !== inventory && destination.items === inventory.items) {
    return { success: false, message: 'Input and output inventory aliases are ambiguous' };
  }
  const copy = value => {
    if (!(value?.items instanceof Map) || !Number.isFinite(value.capacity) || value.capacity < 0) return null;
    let weight = 0;
    for (const [id, amount] of value.items) {
      const definition = resourceDefs.get(id);
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(definition?.weight) || definition.weight <= 0) return null;
      weight += amount * definition.weight;
    }
    if (!Number.isFinite(value.currentWeight) || Math.abs(weight - value.currentWeight) > 1e-7 || weight > value.capacity + 1e-7) return null;
    return { ...value, items: new Map(value.items), currentWeight: weight };
  };
  const input = copy(inventory), output = destination === inventory ? input : copy(destination);
  const outputDef = resourceDefs.get(recipe.output.resourceId);
  if (!input || !output || !Number.isFinite(outputDef?.weight) || outputDef.weight <= 0) {
    return { success: false, message: 'Invalid inventory or resource definition' };
  }
  for (const input of recipe.inputs) {
    if (!Number.isFinite(resourceDefs.get(input.resourceId)?.weight) || resourceDefs.get(input.resourceId).weight <= 0) {
      return { success: false, message: 'Invalid input resource definition' };
    }
  }
  for (const item of recipe.inputs) removeFromInventory(input, item.resourceId, item.amount, resourceDefs.get(item.resourceId));
  if (output.currentWeight + recipe.output.amount * outputDef.weight > output.capacity + 1e-7) {
    return { success: false, message: 'Output capacity unavailable', produced: 0 };
  }
  // The capacity preflight guarantees a complete output, including fractional units.
  output.items.set(recipe.output.resourceId, (output.items.get(recipe.output.resourceId) || 0) + recipe.output.amount);
  output.currentWeight += recipe.output.amount * outputDef.weight;
  inventory.items = input.items; inventory.currentWeight = input.currentWeight;
  if (destination !== inventory) { destination.items = output.items; destination.currentWeight = output.currentWeight; }
  
  // Gain skill
  if (recipe.requiredSkill && recipe.skillGain > 0) {
    skills[recipe.requiredSkill] = (skills[recipe.requiredSkill] || 0) + recipe.skillGain;
  }
  
  return { success: true, produced: recipe.output.amount, resourceId: recipe.output.resourceId };
}

// ============================================================================
// PRODUCTION BUILDINGS
// ============================================================================

/**
 * Create production building
 * @param {Object} config - Building config
 * @returns {Object} Production building
 */
export function createProductionBuilding(config) {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    
    // What it produces
    recipes: config.recipes || [], // Recipe IDs
    
    // Resources
    inputStorage: createInventory(config.inputCapacity || 500),
    outputStorage: createInventory(config.outputCapacity || 500),
    
    // Workers
    workers: [],
    maxWorkers: config.maxWorkers || 5,
    
    // Production state
    currentRecipe: null,
    productionProgress: 0,
    isRunning: false,
    
    // Efficiency
    baseEfficiency: config.baseEfficiency ?? 1,
    currentEfficiency: 1,
  };
}

/**
 * Update production building
 * @param {Object} building - Production building
 * @param {Object} recipes - Map of recipes
 * @param {Object} resourceDefs - Map of resource definitions
 * @param {number} deltaHours - Hours elapsed
 * @returns {{produced: boolean, output: Object|null}}
 */
export function updateProductionBuilding(building, recipes, resourceDefs, deltaHours) {
  if (!Number.isFinite(deltaHours) || deltaHours < 0) throw new RangeError('Production time must be finite and nonnegative');
  if (!building.isRunning || !building.currentRecipe) {
    return { produced: false, output: null };
  }
  
  const recipe = recipes.get(building.currentRecipe);
  if (!recipe) return { produced: false, output: null };
  
  // Calculate efficiency based on workers
  building.currentEfficiency = building.baseEfficiency * 
    (0.5 + 0.5 * (building.workers.length / building.maxWorkers));
  
  // Progress production
  building.productionProgress += deltaHours * building.currentEfficiency;
  
  if (building.productionProgress >= recipe.craftingTime) {
    const result = craft(recipe, building.inputStorage, resourceDefs, {}, {
      station: { id: building.id, type: building.type }, outputInventory: building.outputStorage,
    });
    if (result.success) {
      building.productionProgress -= recipe.craftingTime;
      return { produced: true, output: { resourceId: recipe.output.resourceId, amount: result.produced } };
    }
    // Keep at most one ready batch while blocked; no accumulated instant production.
    building.productionProgress = recipe.craftingTime;
    return { produced: false, output: null, reason: result.message };
  }
  
  return { produced: false, output: null };
}

// ============================================================================
// ECONOMY MANAGER
// ============================================================================

/**
 * Create economy manager
 * @returns {Object} Economy manager
 */
export function createEconomyManager() {
  return {
    resources: new Map(),
    recipes: new Map(),
    markets: new Map(),
    buildings: new Map(),
    
    // Global economic indicators
    inflation: 1.0,
    globalDemandMultiplier: 1.0,
    
    // Time
    economicCycle: 0, // 0-100, affects global trends
  };
}

/**
 * Register resource
 * @param {Object} manager - Economy manager
 * @param {Object} resource - Resource definition
 */
export function registerResource(manager, resource) {
  manager.resources.set(resource.id, resource);
}

/**
 * Register recipe
 * @param {Object} manager - Economy manager
 * @param {Object} recipe - Recipe definition
 */
export function registerRecipe(manager, recipe) {
  manager.recipes.set(recipe.id, recipe);
}

/**
 * Update entire economy
 * @param {Object} manager - Economy manager
 * @param {number} deltaHours - Hours elapsed
 */
export function updateEconomy(manager, deltaHours) {
  // Update economic cycle
  manager.economicCycle = (manager.economicCycle + deltaHours * 0.1) % 100;
  
  // Boom/bust cycle affects demand
  const cyclePosition = Math.sin(manager.economicCycle * Math.PI * 2 / 100);
  manager.globalDemandMultiplier = 1 + cyclePosition * 0.2;
  
  // Update all markets
  for (const [, market] of manager.markets) {
    // Apply global demand multiplier
    for (const [, data] of market.prices) {
      data.demand *= manager.globalDemandMultiplier;
    }
    
    updateMarketPrices(market, deltaHours);
  }
  
  // Update all production buildings
  for (const [, building] of manager.buildings) {
    updateProductionBuilding(building, manager.recipes, manager.resources, deltaHours);
  }
}

// ============================================================================
// PRESET RESOURCES
// ============================================================================

export const PRESET_RESOURCES = {
  // Raw materials
  wood: createResource({ id: "wood", name: "Wood", category: RESOURCE_CATEGORY.RAW, basePrice: 5, weight: 2 }),
  stone: createResource({ id: "stone", name: "Stone", category: RESOURCE_CATEGORY.RAW, basePrice: 3, weight: 5 }),
  iron_ore: createResource({ id: "iron_ore", name: "Iron Ore", category: RESOURCE_CATEGORY.RAW, basePrice: 10, weight: 3 }),
  wheat: createResource({ id: "wheat", name: "Wheat", category: RESOURCE_CATEGORY.RAW, basePrice: 2, weight: 0.5, perishable: true, perishTime: 168 }),
  
  // Refined
  lumber: createResource({ id: "lumber", name: "Lumber", category: RESOURCE_CATEGORY.REFINED, basePrice: 12, weight: 1.5, productionInputs: [{ resourceId: "wood", amount: 2 }] }),
  iron_ingot: createResource({ id: "iron_ingot", name: "Iron Ingot", category: RESOURCE_CATEGORY.REFINED, basePrice: 25, weight: 2, productionInputs: [{ resourceId: "iron_ore", amount: 3 }] }),
  flour: createResource({ id: "flour", name: "Flour", category: RESOURCE_CATEGORY.REFINED, basePrice: 5, weight: 0.3, productionInputs: [{ resourceId: "wheat", amount: 2 }] }),
  
  // Crafted
  bread: createResource({ id: "bread", name: "Bread", category: RESOURCE_CATEGORY.CRAFTED, basePrice: 8, weight: 0.2, isConsumable: true, consumptionRate: 1, perishable: true, perishTime: 48 }),
  sword: createResource({ id: "sword", name: "Iron Sword", category: RESOURCE_CATEGORY.CRAFTED, basePrice: 100, weight: 3, productionInputs: [{ resourceId: "iron_ingot", amount: 2 }, { resourceId: "wood", amount: 1 }] }),
  
  // Luxury
  gold: createResource({ id: "gold", name: "Gold", category: RESOURCE_CATEGORY.LUXURY, basePrice: 500, weight: 0.5 }),
  gems: createResource({ id: "gems", name: "Gems", category: RESOURCE_CATEGORY.LUXURY, basePrice: 200, weight: 0.1 }),
};
