// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIEcology.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIEcology.js (original) - Ecosystem and Wildlife Simulation
 * 
 * Features:
 * - Predator-prey dynamics
 * - Food chains and webs
 * - Population dynamics (birth, death, migration)
 * - Territory and habitats
 * - Seasonal behavior
 * - Herd/pack behavior
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Species roles in ecosystem */
export const SPECIES_ROLE = {
  PRODUCER: "producer",       // Plants
  HERBIVORE: "herbivore",     // Plant eaters
  CARNIVORE: "carnivore",     // Meat eaters
  OMNIVORE: "omnivore",       // Both
  DECOMPOSER: "decomposer",   // Breaks down dead matter
  APEX_PREDATOR: "apex",      // Top of food chain
};

/** Activity states */
export const CREATURE_STATE = {
  IDLE: "idle",
  FORAGING: "foraging",
  HUNTING: "hunting",
  FLEEING: "fleeing",
  RESTING: "resting",
  MATING: "mating",
  MIGRATING: "migrating",
  DEFENDING: "defending",
  DEAD: "dead",
};

// ============================================================================
// SPECIES DEFINITION
// ============================================================================

/**
 * Create species definition
 * @param {Object} config - Species config
 * @returns {Object} Species definition
 */
export function createSpecies(config) {
  return {
    id: config.id,
    name: config.name,
    role: config.role || SPECIES_ROLE.HERBIVORE,
    
    // Diet
    prey: config.prey || [],          // Species IDs this can eat
    predators: config.predators || [], // Species IDs that eat this
    
    // Stats
    maxHealth: config.maxHealth || 100,
    maxHunger: config.maxHunger || 100,
    hungerRate: config.hungerRate || 1,    // Per game hour
    speed: config.speed || 5,
    sightRange: config.sightRange || 20,
    
    // Reproduction
    matingAge: config.matingAge || 1,       // Game days
    gestationTime: config.gestationTime || 1,
    litterSize: config.litterSize || [1, 3], // [min, max]
    matingCooldown: config.matingCooldown || 5,
    
    // Lifespan
    maxAge: config.maxAge || 30,            // Game days
    
    // Social
    isSocial: config.isSocial ?? false,
    packSize: config.packSize || [1, 1],    // [min, max]
    
    // Habitat
    preferredBiomes: config.preferredBiomes || ["all"],
    territorySize: config.territorySize || 50,
    
    // Behavior
    flightDistance: config.flightDistance || 15,  // Distance to flee from predator
    aggression: config.aggression ?? 0.3,
    isNocturnal: config.isNocturnal ?? false,
  };
}

// ============================================================================
// CREATURE INSTANCE
// ============================================================================

/**
 * Create creature instance
 * @param {Object} species - Species definition
 * @param {number[]} position - Starting position
 * @returns {Object} Creature instance
 */
export function createCreature(species, position) {
  return {
    id: aiRng.uniqueId('creature'),
    speciesId: species.id,
    species, // Reference
    
    // Position
    position: [...position],
    velocity: [0, 0, 0],
    
    // Stats
    health: species.maxHealth,
    hunger: species.maxHunger * 0.7,
    age: 0, // Game days
    
    // State
    state: CREATURE_STATE.IDLE,
    target: null,           // Current target (food, mate, threat)
    homePosition: [...position],
    
    // Reproduction
    canMate: false,
    pregnant: false,
    pregnancyProgress: 0,
    lastMatingTime: -Infinity,
    
    // Social
    packId: null,
    isPackLeader: false,
    
    // Memory
    knownFoodSources: [],
    knownThreats: [],
    lastSeenPredator: null,
    lastSeenPredatorTime: 0,
  };
}

// ============================================================================
// ECOSYSTEM
// ============================================================================

/**
 * Create ecosystem manager
 * @param {Object} config - Ecosystem config
 * @returns {Object} Ecosystem
 */
export function createEcosystem(config = {}) {
  return {
    // Species registry
    species: new Map(),
    
    // Active creatures
    creatures: new Map(),
    
    // Packs/herds
    packs: new Map(),
    
    // Food sources (plants, carcasses)
    foodSources: new Map(),
    
    // Configuration
    worldBounds: config.worldBounds || { min: [0, 0, 0], max: [1000, 100, 1000] },
    maxCreatures: config.maxCreatures || 1000,
    
    // Time
    currentHour: 12,
    currentDay: 0,
    currentSeason: "summer", // spring, summer, fall, winter
    
    // Stats
    populationHistory: new Map(), // speciesId → [counts]
  };
}

/**
 * Register species in ecosystem
 * @param {Object} eco - Ecosystem
 * @param {Object} species - Species to register
 */
export function registerSpecies(eco, species) {
  eco.species.set(species.id, species);
  eco.populationHistory.set(species.id, []);
}

/**
 * Spawn creature in ecosystem
 * @param {Object} eco - Ecosystem
 * @param {string} speciesId - Species ID
 * @param {number[]} position - Position
 * @returns {Object} Created creature
 */
export function spawnCreature(eco, speciesId, position) {
  if (eco.creatures.size >= eco.maxCreatures) {
    return null;
  }
  
  const species = eco.species.get(speciesId);
  if (!species) return null;
  
  const creature = createCreature(species, position);
  eco.creatures.set(creature.id, creature);
  
  return creature;
}

/**
 * Remove creature from ecosystem
 * @param {Object} eco - Ecosystem
 * @param {string} creatureId - Creature ID
 * @param {string} cause - Death cause
 */
export function removeCreature(eco, creatureId, cause = "natural") {
  const creature = eco.creatures.get(creatureId);
  if (!creature) return;
  
  // Create carcass if killed
  if (cause === "killed" || cause === "natural") {
    createFoodSource(eco, creature.position, "carcass", creature.species.maxHealth * 0.5);
  }
  
  // Remove from pack
  if (creature.packId) {
    const pack = eco.packs.get(creature.packId);
    if (pack) {
      pack.members.delete(creatureId);
      if (pack.leaderId === creatureId) {
        assignNewPackLeader(eco, pack);
      }
    }
  }
  
  eco.creatures.delete(creatureId);
}

// ============================================================================
// FOOD SOURCES
// ============================================================================

/**
 * Create food source
 * @param {Object} eco - Ecosystem
 * @param {number[]} position - Position
 * @param {string} type - "plant", "carcass", "fruit"
 * @param {number} nutrition - Nutritional value
 */
export function createFoodSource(eco, position, type, nutrition) {
  const id = aiRng.uniqueId('food');
  
  eco.foodSources.set(id, {
    id,
    position: [...position],
    type,
    nutrition,
    maxNutrition: nutrition,
    regenerates: type === "plant",
    regenRate: type === "plant" ? 0.1 : 0, // Per game hour
    decayRate: type === "carcass" ? 0.05 : 0,
  });
  
  return id;
}

/**
 * Consume food source
 * @param {Object} eco - Ecosystem
 * @param {string} foodId - Food source ID
 * @param {number} amount - Amount to consume
 * @returns {number} Actual amount consumed
 */
export function consumeFood(eco, foodId, amount) {
  const food = eco.foodSources.get(foodId);
  if (!food) return 0;
  
  const consumed = Math.min(food.nutrition, amount);
  food.nutrition -= consumed;
  
  if (food.nutrition <= 0 && !food.regenerates) {
    eco.foodSources.delete(foodId);
  }
  
  return consumed;
}

// ============================================================================
// PACKS AND HERDS
// ============================================================================

/**
 * Create pack/herd
 * @param {Object} eco - Ecosystem
 * @param {string} speciesId - Species ID
 * @param {string} leaderId - Leader creature ID
 * @returns {Object} Pack
 */
export function createPack(eco, speciesId, leaderId) {
  const id = aiRng.uniqueId('pack');
  
  const pack = {
    id,
    speciesId,
    leaderId,
    members: new Set([leaderId]),
    territory: null,
  };
  
  eco.packs.set(id, pack);
  
  const leader = eco.creatures.get(leaderId);
  if (leader) {
    leader.packId = id;
    leader.isPackLeader = true;
  }
  
  return pack;
}

/**
 * Add creature to pack
 * @param {Object} eco - Ecosystem
 * @param {string} packId - Pack ID
 * @param {string} creatureId - Creature ID
 */
export function addToPack(eco, packId, creatureId) {
  const pack = eco.packs.get(packId);
  const creature = eco.creatures.get(creatureId);
  
  if (!pack || !creature) return;
  if (creature.speciesId !== pack.speciesId) return;
  
  pack.members.add(creatureId);
  creature.packId = packId;
}

/**
 * Assign new pack leader
 * @param {Object} eco - Ecosystem
 * @param {Object} pack - Pack
 */
function assignNewPackLeader(eco, pack) {
  if (pack.members.size === 0) {
    eco.packs.delete(pack.id);
    return;
  }
  
  // Find strongest remaining member
  let bestHealth = 0;
  let newLeader = null;
  
  for (const memberId of pack.members) {
    const member = eco.creatures.get(memberId);
    if (member && member.health > bestHealth) {
      bestHealth = member.health;
      newLeader = member;
    }
  }
  
  if (newLeader) {
    pack.leaderId = newLeader.id;
    newLeader.isPackLeader = true;
  }
}

// ============================================================================
// CREATURE AI
// ============================================================================

/**
 * Update creature behavior
 * @param {Object} eco - Ecosystem
 * @param {Object} creature - Creature to update
 * @param {number} deltaHours - Game hours elapsed
 */
export function updateCreature(eco, creature, deltaHours) {
  if (creature.state === CREATURE_STATE.DEAD) return;
  
  // Update hunger
  creature.hunger -= creature.species.hungerRate * deltaHours;
  
  // Starvation
  if (creature.hunger <= 0) {
    creature.health -= 10 * deltaHours;
    creature.hunger = 0;
  }
  
  // Death check
  if (creature.health <= 0) {
    creature.state = CREATURE_STATE.DEAD;
    removeCreature(eco, creature.id, "natural");
    return;
  }
  
  // Age
  creature.age += deltaHours / 24;
  if (creature.age >= creature.species.maxAge) {
    creature.state = CREATURE_STATE.DEAD;
    removeCreature(eco, creature.id, "natural");
    return;
  }
  
  // Check for threats
  const nearbyThreat = findNearestThreat(eco, creature);
  if (nearbyThreat) {
    creature.state = CREATURE_STATE.FLEEING;
    creature.target = nearbyThreat;
    creature.lastSeenPredator = nearbyThreat.position;
    creature.lastSeenPredatorTime = eco.currentHour;
    return;
  }
  
  // Pregnancy progress
  if (creature.pregnant) {
    creature.pregnancyProgress += deltaHours / 24;
    if (creature.pregnancyProgress >= creature.species.gestationTime) {
      giveBirth(eco, creature);
    }
  }
  
  // State machine
  switch (creature.state) {
    case CREATURE_STATE.IDLE:
      decideNextAction(eco, creature);
      break;
      
    case CREATURE_STATE.FORAGING:
      updateForaging(eco, creature);
      break;
      
    case CREATURE_STATE.HUNTING:
      updateHunting(eco, creature);
      break;
      
    case CREATURE_STATE.FLEEING:
      updateFleeing(eco, creature);
      break;
      
    case CREATURE_STATE.MATING:
      updateMating(eco, creature);
      break;
      
    case CREATURE_STATE.RESTING:
      updateResting(eco, creature, deltaHours);
      break;
  }
}

/**
 * Decide next action for idle creature
 */
function decideNextAction(eco, creature) {
  // Hungry? Find food
  if (creature.hunger < creature.species.maxHunger * 0.5) {
    if (creature.species.role === SPECIES_ROLE.CARNIVORE || 
        creature.species.role === SPECIES_ROLE.APEX_PREDATOR) {
      creature.state = CREATURE_STATE.HUNTING;
    } else {
      creature.state = CREATURE_STATE.FORAGING;
    }
    return;
  }
  
  // Can mate?
  if (canMate(eco, creature)) {
    const mate = findMate(eco, creature);
    if (mate) {
      creature.state = CREATURE_STATE.MATING;
      creature.target = mate;
      return;
    }
  }
  
  // Rest if tired (night for diurnal, day for nocturnal)
  const isNight = eco.currentHour < 6 || eco.currentHour > 20;
  if ((isNight && !creature.species.isNocturnal) || 
      (!isNight && creature.species.isNocturnal)) {
    creature.state = CREATURE_STATE.RESTING;
    return;
  }
  
  // Wander
  creature.state = CREATURE_STATE.FORAGING;
}

/**
 * Find nearest threat
 */
function findNearestThreat(eco, creature) {
  let nearest = null;
  let nearestDist = creature.species.flightDistance;
  
  for (const [, other] of eco.creatures) {
    if (other.id === creature.id) continue;
    if (!creature.species.predators.includes(other.speciesId)) continue;
    
    const dist = distance(creature.position, other.position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }
  
  return nearest;
}

/**
 * Find nearest food
 */
function findNearestFood(eco, creature) {
  let nearest = null;
  let nearestDist = creature.species.sightRange;
  
  // Check food sources for herbivores
  if (creature.species.role === SPECIES_ROLE.HERBIVORE || 
      creature.species.role === SPECIES_ROLE.OMNIVORE) {
    for (const [, food] of eco.foodSources) {
      if (food.type !== "carcass") {
        const dist = distance(creature.position, food.position);
        if (dist < nearestDist && food.nutrition > 0) {
          nearestDist = dist;
          nearest = { type: "food", target: food };
        }
      }
    }
  }
  
  return nearest;
}

/**
 * Find prey for hunting
 */
function findPrey(eco, creature) {
  let nearest = null;
  let nearestDist = creature.species.sightRange;
  
  for (const [, other] of eco.creatures) {
    if (other.id === creature.id) continue;
    if (!creature.species.prey.includes(other.speciesId)) continue;
    if (other.state === CREATURE_STATE.DEAD) continue;
    
    const dist = distance(creature.position, other.position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }
  
  return nearest;
}

/**
 * Find potential mate
 */
function findMate(eco, creature) {
  for (const [, other] of eco.creatures) {
    if (other.id === creature.id) continue;
    if (other.speciesId !== creature.speciesId) continue;
    if (!canMate(eco, other)) continue;
    
    const dist = distance(creature.position, other.position);
    if (dist < creature.species.sightRange) {
      return other;
    }
  }
  return null;
}

/**
 * Check if creature can mate
 */
function canMate(eco, creature) {
  if (creature.pregnant) return false;
  if (creature.age < creature.species.matingAge) return false;
  if (eco.currentDay - creature.lastMatingTime < creature.species.matingCooldown) return false;
  return true;
}

/**
 * Give birth
 */
function giveBirth(eco, creature) {
  creature.pregnant = false;
  creature.pregnancyProgress = 0;
  
  const [minLitter, maxLitter] = creature.species.litterSize;
  const litterSize = aiRng.intRange(minLitter, maxLitter);
  
  for (let i = 0; i < litterSize; i++) {
    const offset = [aiRng.range(-2.5, 2.5), 0, aiRng.range(-2.5, 2.5)];
    const pos = [
      creature.position[0] + offset[0],
      creature.position[1],
      creature.position[2] + offset[2],
    ];
    
    const baby = spawnCreature(eco, creature.speciesId, pos);
    if (baby && creature.packId) {
      addToPack(eco, creature.packId, baby.id);
    }
  }
}

// Behavior updates
function updateForaging(eco, creature) {
  const food = findNearestFood(eco, creature);
  if (food) {
    creature.target = food.target;
    moveToward(creature, food.target.position);
    
    if (distance(creature.position, food.target.position) < 2) {
      const consumed = consumeFood(eco, food.target.id, 20);
      creature.hunger = Math.min(creature.species.maxHunger, creature.hunger + consumed);
      creature.state = CREATURE_STATE.IDLE;
    }
  } else {
    wander(creature);
  }
}

function updateHunting(eco, creature) {
  const prey = findPrey(eco, creature);
  if (prey) {
    creature.target = prey;
    moveToward(creature, prey.position);
    
    if (distance(creature.position, prey.position) < 2) {
      // Attack
      prey.health -= 30;
      if (prey.health <= 0) {
        creature.hunger = Math.min(creature.species.maxHunger, creature.hunger + 50);
        removeCreature(eco, prey.id, "killed");
      }
      creature.state = CREATURE_STATE.IDLE;
    }
  } else {
    wander(creature);
  }
}

function updateFleeing(eco, creature) {
  if (!creature.target) {
    creature.state = CREATURE_STATE.IDLE;
    return;
  }
  
  moveAwayFrom(creature, creature.target.position);
  
  if (distance(creature.position, creature.target.position) > creature.species.flightDistance * 2) {
    creature.state = CREATURE_STATE.IDLE;
    creature.target = null;
  }
}

function updateMating(eco, creature) {
  if (!creature.target) {
    creature.state = CREATURE_STATE.IDLE;
    return;
  }
  
  moveToward(creature, creature.target.position);
  
  if (distance(creature.position, creature.target.position) < 2) {
    creature.pregnant = true;
    creature.lastMatingTime = eco.currentDay;
    creature.target.lastMatingTime = eco.currentDay;
    creature.state = CREATURE_STATE.IDLE;
    creature.target.state = CREATURE_STATE.IDLE;
  }
}

function updateResting(eco, creature, deltaHours) {
  creature.health = Math.min(creature.species.maxHealth, creature.health + deltaHours * 2);
}

// Movement helpers
function moveToward(creature, target) {
  const dir = normalize([
    target[0] - creature.position[0],
    0,
    target[2] - creature.position[2],
  ]);
  creature.velocity = [dir[0] * creature.species.speed, 0, dir[2] * creature.species.speed];
}

function moveAwayFrom(creature, target) {
  const dir = normalize([
    creature.position[0] - target[0],
    0,
    creature.position[2] - target[2],
  ]);
  creature.velocity = [dir[0] * creature.species.speed * 1.5, 0, dir[2] * creature.species.speed * 1.5];
}

function wander(creature) {
  const angle = aiRng.float() * Math.PI * 2;
  creature.velocity = [
    Math.cos(angle) * creature.species.speed * 0.3,
    0,
    Math.sin(angle) * creature.species.speed * 0.3,
  ];
}

function distance(a, b) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function normalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 0.001) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ============================================================================
// ECOSYSTEM UPDATE
// ============================================================================

/**
 * Update entire ecosystem
 * @param {Object} eco - Ecosystem
 * @param {number} deltaHours - Game hours elapsed
 */
export function updateEcosystem(eco, deltaHours) {
  eco.currentHour = (eco.currentHour + deltaHours) % 24;
  if (eco.currentHour < deltaHours) {
    eco.currentDay++;
  }
  
  // Update all creatures
  for (const [, creature] of eco.creatures) {
    updateCreature(eco, creature, deltaHours);
    
    // Apply velocity
    creature.position[0] += creature.velocity[0] * deltaHours;
    creature.position[2] += creature.velocity[2] * deltaHours;
  }
  
  // Update food sources
  for (const [id, food] of eco.foodSources) {
    if (food.regenerates && food.nutrition < food.maxNutrition) {
      food.nutrition = Math.min(food.maxNutrition, food.nutrition + food.regenRate * deltaHours);
    }
    if (food.decayRate > 0) {
      food.nutrition -= food.decayRate * deltaHours;
      if (food.nutrition <= 0) {
        eco.foodSources.delete(id);
      }
    }
  }
  
  // Record population stats periodically
  if (Math.floor(eco.currentDay) !== Math.floor(eco.currentDay - deltaHours / 24)) {
    recordPopulationStats(eco);
  }
}

/**
 * Record population statistics
 */
function recordPopulationStats(eco) {
  const counts = new Map();
  
  for (const [, creature] of eco.creatures) {
    const count = counts.get(creature.speciesId) || 0;
    counts.set(creature.speciesId, count + 1);
  }
  
  for (const [speciesId, history] of eco.populationHistory) {
    history.push(counts.get(speciesId) || 0);
    if (history.length > 100) history.shift();
  }
}

/**
 * Get ecosystem statistics
 * @param {Object} eco - Ecosystem
 * @returns {Object} Statistics
 */
export function getEcosystemStats(eco) {
  const stats = {
    totalCreatures: eco.creatures.size,
    totalFoodSources: eco.foodSources.size,
    populations: {},
    averageHealth: 0,
    averageHunger: 0,
  };
  
  let totalHealth = 0;
  let totalHunger = 0;
  
  for (const [speciesId] of eco.species) {
    stats.populations[speciesId] = 0;
  }
  
  for (const [, creature] of eco.creatures) {
    stats.populations[creature.speciesId]++;
    totalHealth += creature.health;
    totalHunger += creature.hunger;
  }
  
  if (eco.creatures.size > 0) {
    stats.averageHealth = totalHealth / eco.creatures.size;
    stats.averageHunger = totalHunger / eco.creatures.size;
  }
  
  return stats;
}
