// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIFaction.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 * 
 * Uses AISchema.js for consistent faction/reputation definitions.
 */

import { aiRng } from './AIRandom.js';
import {
  DIPLOMATIC_STANCES,
  REPUTATION_LEVELS,
  FACTION_SCHEMA,
  createDefaultFaction,
  getReputationLevel,
} from './AISchema.js';

/**
 * AIFaction.js (original) - Factions, Reputation, and Diplomacy
 * 
 * Features:
 * - Faction definitions and membership
 * - Reputation tracking
 * - Diplomatic relations (alliance, war, trade)
 * - Territory control
 */

// ============================================================================
// CONSTANTS (from AISchema for backwards compatibility)
// ============================================================================

/** Diplomatic stance */
export const DIPLOMATIC_STANCE = {
  WAR: DIPLOMATIC_STANCES.war.id,
  HOSTILE: DIPLOMATIC_STANCES.hostile.id,
  UNFRIENDLY: DIPLOMATIC_STANCES.unfriendly.id,
  NEUTRAL: DIPLOMATIC_STANCES.neutral.id,
  FRIENDLY: DIPLOMATIC_STANCES.friendly.id,
  ALLIED: DIPLOMATIC_STANCES.allied.id,
  VASSAL: DIPLOMATIC_STANCES.vassal.id,
};

/** Reputation thresholds - from AISchema */
export const REPUTATION_LEVEL = {
  HATED: REPUTATION_LEVELS.hated,
  HOSTILE: REPUTATION_LEVELS.hostile,
  UNFRIENDLY: REPUTATION_LEVELS.unfriendly,
  NEUTRAL: REPUTATION_LEVELS.neutral,
  FRIENDLY: REPUTATION_LEVELS.friendly,
  HONORED: REPUTATION_LEVELS.honored,
  REVERED: REPUTATION_LEVELS.revered,
  EXALTED: REPUTATION_LEVELS.exalted,
};

// Re-export schema utilities
export { getReputationLevel };

// ============================================================================
// FACTION DEFINITION
// ============================================================================

/**
 * Create a faction
 * @param {Object} config - Faction configuration
 * @returns {Object} Faction
 */
export function createFaction(config) {
  return {
    id: config.id,
    name: config.name,
    description: config.description || "",
    
    // Visual
    color: config.color || [128, 128, 128],
    emblem: config.emblem || null,
    
    // Members
    members: new Set(config.members || []),
    leaderId: config.leaderId || null,
    
    // Territory
    territories: new Set(config.territories || []),
    capitalTerritory: config.capitalTerritory || null,
    
    // Resources
    treasury: config.treasury || 0,
    resources: config.resources || {},
    
    // Traits
    traits: config.traits || [], // aggressive, peaceful, merchant, etc.
    
    // AI Behavior weights
    aggressiveness: config.aggressiveness ?? 0.5,
    expansionism: config.expansionism ?? 0.5,
    tradeFocus: config.tradeFocus ?? 0.5,
    
    // Reputation with player
    playerReputation: config.playerReputation ?? 0,
  };
}

// ============================================================================
// FACTION MANAGER
// ============================================================================

/**
 * Create faction manager
 * @returns {Object} Faction manager
 */
export function createFactionManager() {
  return {
    factions: new Map(),
    
    // Diplomatic relations matrix: factionId → Map(otherFactionId → relation)
    relations: new Map(),
    
    // Active treaties
    treaties: [],
    
    // Trade routes
    tradeRoutes: [],
    
    // Entity faction membership
    entityFactions: new Map(), // entityId → factionId
  };
}

/**
 * Register a faction
 * @param {Object} manager - Faction manager
 * @param {Object} faction - Faction to register
 */
export function registerFaction(manager, faction) {
  manager.factions.set(faction.id, faction);
  manager.relations.set(faction.id, new Map());
  
  // Initialize relations with existing factions
  for (const [otherId, otherFaction] of manager.factions) {
    if (otherId !== faction.id) {
      setDiplomaticStance(manager, faction.id, otherId, DIPLOMATIC_STANCE.NEUTRAL);
    }
  }
  
  // Register members
  for (const memberId of faction.members) {
    manager.entityFactions.set(memberId, faction.id);
  }
}

/**
 * Get entity's faction
 * @param {Object} manager - Faction manager
 * @param {number} entityId - Entity ID
 * @returns {Object|null} Faction
 */
export function getEntityFaction(manager, entityId) {
  const factionId = manager.entityFactions.get(entityId);
  if (!factionId) return null;
  return manager.factions.get(factionId) || null;
}

/**
 * Add entity to faction
 * @param {Object} manager - Faction manager
 * @param {number} entityId - Entity ID
 * @param {string} factionId - Faction ID
 */
export function addToFaction(manager, entityId, factionId) {
  const faction = manager.factions.get(factionId);
  if (!faction) return;
  
  // Remove from current faction
  const currentFactionId = manager.entityFactions.get(entityId);
  if (currentFactionId) {
    const currentFaction = manager.factions.get(currentFactionId);
    if (currentFaction) currentFaction.members.delete(entityId);
  }
  
  faction.members.add(entityId);
  manager.entityFactions.set(entityId, factionId);
}

// ============================================================================
// DIPLOMATIC RELATIONS
// ============================================================================

/**
 * Set diplomatic stance between factions
 * @param {Object} manager - Faction manager
 * @param {string} factionA - First faction ID
 * @param {string} factionB - Second faction ID
 * @param {number} stance - DIPLOMATIC_STANCE value
 */
export function setDiplomaticStance(manager, factionA, factionB, stance) {
  if (!manager.relations.has(factionA)) {
    manager.relations.set(factionA, new Map());
  }
  if (!manager.relations.has(factionB)) {
    manager.relations.set(factionB, new Map());
  }
  
  manager.relations.get(factionA).set(factionB, stance);
  manager.relations.get(factionB).set(factionA, stance);
}

/**
 * Get diplomatic stance between factions
 * @param {Object} manager - Faction manager
 * @param {string} factionA - First faction ID
 * @param {string} factionB - Second faction ID
 * @returns {number} DIPLOMATIC_STANCE value
 */
export function getDiplomaticStance(manager, factionA, factionB) {
  if (factionA === factionB) return DIPLOMATIC_STANCE.ALLIED;
  
  const relations = manager.relations.get(factionA);
  if (!relations) return DIPLOMATIC_STANCE.NEUTRAL;
  
  return relations.get(factionB) ?? DIPLOMATIC_STANCE.NEUTRAL;
}

/**
 * Check if factions are hostile
 * @param {Object} manager - Faction manager
 * @param {string} factionA - First faction ID
 * @param {string} factionB - Second faction ID
 * @returns {boolean} Are hostile
 */
export function areFactionsHostile(manager, factionA, factionB) {
  return getDiplomaticStance(manager, factionA, factionB) < DIPLOMATIC_STANCE.NEUTRAL;
}

/**
 * Check if factions are allied
 * @param {Object} manager - Faction manager
 * @param {string} factionA - First faction ID
 * @param {string} factionB - Second faction ID
 * @returns {boolean} Are allied
 */
export function areFactionsAllied(manager, factionA, factionB) {
  return getDiplomaticStance(manager, factionA, factionB) >= DIPLOMATIC_STANCE.ALLIED;
}

/**
 * Check if two entities are hostile to each other
 * @param {Object} manager - Faction manager
 * @param {number} entityA - First entity ID
 * @param {number} entityB - Second entity ID
 * @returns {boolean} Are hostile
 */
export function areEntitiesHostile(manager, entityA, entityB) {
  const factionA = manager.entityFactions.get(entityA);
  const factionB = manager.entityFactions.get(entityB);
  
  if (!factionA || !factionB) return false;
  if (factionA === factionB) return false;
  
  return areFactionsHostile(manager, factionA, factionB);
}

// ============================================================================
// REPUTATION
// ============================================================================

/**
 * Modify player reputation with faction
 * @param {Object} manager - Faction manager
 * @param {string} factionId - Faction ID
 * @param {number} delta - Reputation change
 */
export function modifyPlayerReputation(manager, factionId, delta) {
  const faction = manager.factions.get(factionId);
  if (!faction) return;
  
  faction.playerReputation = Math.max(-1000, Math.min(1000, faction.playerReputation + delta));
}

/**
 * Get player reputation level with faction
 * @param {Object} manager - Faction manager
 * @param {string} factionId - Faction ID
 * @returns {Object} {level: string, value: number}
 */
export function getPlayerReputationLevel(manager, factionId) {
  const faction = manager.factions.get(factionId);
  if (!faction) return { level: "Neutral", value: 0 };
  
  const rep = faction.playerReputation;
  
  for (const [key, range] of Object.entries(REPUTATION_LEVEL)) {
    if (rep >= range.min && rep < range.max) {
      return { level: range.name, value: rep };
    }
  }
  
  return { level: "Neutral", value: rep };
}

/**
 * Check if player can access faction services
 * @param {Object} manager - Faction manager
 * @param {string} factionId - Faction ID
 * @param {string} service - Service type
 * @returns {boolean} Can access
 */
export function canAccessFactionService(manager, factionId, service) {
  const faction = manager.factions.get(factionId);
  if (!faction) return false;
  
  const rep = faction.playerReputation;
  
  const requirements = {
    basic_trade: -200,
    advanced_trade: 0,
    training: 50,
    special_quests: 200,
    faction_gear: 500,
    leadership: 800,
  };
  
  return rep >= (requirements[service] ?? 0);
}

// ============================================================================
// TREATIES
// ============================================================================

/** Treaty types */
export const TREATY_TYPE = {
  PEACE: "peace",
  NON_AGGRESSION: "non_aggression",
  TRADE: "trade",
  MILITARY_ACCESS: "military_access",
  DEFENSIVE_ALLIANCE: "defensive_alliance",
  OFFENSIVE_ALLIANCE: "offensive_alliance",
  VASSALAGE: "vassalage",
};

/**
 * Create a treaty
 * @param {Object} config - Treaty config
 * @returns {Object} Treaty
 */
export function createTreaty(config) {
  return {
    id: config.id || aiRng.uniqueId('treaty'),
    type: config.type,
    parties: [...config.parties], // Faction IDs
    terms: config.terms || {},
    created: performance.now(),
    expires: config.expires || null, // null = permanent
    active: true,
  };
}

/**
 * Propose treaty
 * @param {Object} manager - Faction manager
 * @param {Object} treaty - Treaty to propose
 * @returns {boolean} Was accepted
 */
export function proposeTreaty(manager, treaty) {
  // AI acceptance logic based on faction traits and relations
  const [proposer, target] = treaty.parties;
  const proposerFaction = manager.factions.get(proposer);
  const targetFaction = manager.factions.get(target);
  
  if (!proposerFaction || !targetFaction) return false;
  
  const currentStance = getDiplomaticStance(manager, proposer, target);
  
  // Calculate acceptance chance
  let acceptChance = 0.5;
  
  // More peaceful factions accept more easily
  acceptChance += (1 - targetFaction.aggressiveness) * 0.2;
  
  // Better relations = higher chance
  acceptChance += currentStance * 0.1;
  
  // Trade treaties easier if trade-focused
  if (treaty.type === TREATY_TYPE.TRADE) {
    acceptChance += targetFaction.tradeFocus * 0.3;
  }
  
  // Alliances harder with aggressive factions
  if (treaty.type === TREATY_TYPE.DEFENSIVE_ALLIANCE || treaty.type === TREATY_TYPE.OFFENSIVE_ALLIANCE) {
    acceptChance -= targetFaction.aggressiveness * 0.2;
  }
  
  if (aiRng.chance(acceptChance)) {
    manager.treaties.push(treaty);
    
    // Update diplomatic stance based on treaty
    if (treaty.type === TREATY_TYPE.PEACE) {
      setDiplomaticStance(manager, proposer, target, DIPLOMATIC_STANCE.NEUTRAL);
    } else if (treaty.type === TREATY_TYPE.DEFENSIVE_ALLIANCE || treaty.type === TREATY_TYPE.OFFENSIVE_ALLIANCE) {
      setDiplomaticStance(manager, proposer, target, DIPLOMATIC_STANCE.ALLIED);
    } else if (treaty.type === TREATY_TYPE.TRADE) {
      const current = getDiplomaticStance(manager, proposer, target);
      if (current < DIPLOMATIC_STANCE.FRIENDLY) {
        setDiplomaticStance(manager, proposer, target, DIPLOMATIC_STANCE.FRIENDLY);
      }
    }
    
    return true;
  }
  
  return false;
}

/**
 * Declare war
 * @param {Object} manager - Faction manager
 * @param {string} aggressor - Aggressor faction ID
 * @param {string} target - Target faction ID
 */
export function declareWar(manager, aggressor, target) {
  setDiplomaticStance(manager, aggressor, target, DIPLOMATIC_STANCE.WAR);
  
  // Cancel relevant treaties
  manager.treaties = manager.treaties.filter(t => {
    if (t.parties.includes(aggressor) && t.parties.includes(target)) {
      return false;
    }
    return true;
  });
  
  // Allied factions may join
  for (const treaty of manager.treaties) {
    if (treaty.type === TREATY_TYPE.DEFENSIVE_ALLIANCE) {
      if (treaty.parties.includes(target)) {
        const ally = treaty.parties.find(p => p !== target);
        if (ally && ally !== aggressor) {
          setDiplomaticStance(manager, ally, aggressor, DIPLOMATIC_STANCE.WAR);
        }
      }
    }
  }
}

// ============================================================================
// TERRITORY
// ============================================================================

/**
 * Claim territory for faction
 * @param {Object} manager - Faction manager
 * @param {string} factionId - Faction ID
 * @param {string} territoryId - Territory ID
 */
export function claimTerritory(manager, factionId, territoryId) {
  const faction = manager.factions.get(factionId);
  if (!faction) return;
  
  // Remove from current owner
  for (const [, f] of manager.factions) {
    f.territories.delete(territoryId);
  }
  
  faction.territories.add(territoryId);
}

/**
 * Get territory owner
 * @param {Object} manager - Faction manager
 * @param {string} territoryId - Territory ID
 * @returns {string|null} Owner faction ID
 */
export function getTerritoryOwner(manager, territoryId) {
  for (const [factionId, faction] of manager.factions) {
    if (faction.territories.has(territoryId)) {
      return factionId;
    }
  }
  return null;
}

/**
 * Calculate faction power
 * @param {Object} manager - Faction manager
 * @param {string} factionId - Faction ID
 * @returns {number} Power score
 */
export function calculateFactionPower(manager, factionId) {
  const faction = manager.factions.get(factionId);
  if (!faction) return 0;
  
  let power = 0;
  
  // Members contribute to power
  power += faction.members.size * 10;
  
  // Territory contributes
  power += faction.territories.size * 50;
  
  // Treasury contributes
  power += Math.sqrt(faction.treasury);
  
  // Allied factions contribute partially
  for (const [otherId] of manager.factions) {
    if (otherId !== factionId && areFactionsAllied(manager, factionId, otherId)) {
      const ally = manager.factions.get(otherId);
      power += ally.members.size * 3;
    }
  }
  
  return power;
}
