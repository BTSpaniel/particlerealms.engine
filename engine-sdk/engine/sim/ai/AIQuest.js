// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIQuest.js - Procedural Quest Generation System
 * 
 * Features:
 * - Quest templates and generation
 * - Objective chaining
 * - Dynamic rewards
 * - Quest givers and hand-ins
 * - Prerequisites and branching
 * - Procedural narrative generation
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Quest types */
export const QUEST_TYPE = {
  KILL: "kill",               // Kill X enemies
  COLLECT: "collect",         // Gather X items
  DELIVER: "deliver",         // Bring item to NPC
  ESCORT: "escort",           // Protect NPC
  EXPLORE: "explore",         // Discover location
  TALK: "talk",               // Speak to NPC
  DEFEND: "defend",           // Protect location
  RESCUE: "rescue",           // Save someone
  STEAL: "steal",             // Take item secretly
  CRAFT: "craft",             // Make something
  INVESTIGATE: "investigate", // Find clues
  RACE: "race",               // Time trial
  BOUNTY: "bounty",           // Hunt specific target
};

/** Quest status */
export const QUEST_STATUS = {
  UNAVAILABLE: "unavailable",
  AVAILABLE: "available",
  ACTIVE: "active",
  COMPLETE: "complete",
  FAILED: "failed",
  TURNED_IN: "turned_in",
};

/** Quest priority */
export const QUEST_PRIORITY = {
  MAIN: "main",
  SIDE: "side",
  DAILY: "daily",
  WORLD: "world",
  HIDDEN: "hidden",
};

// ============================================================================
// QUEST OBJECTIVE
// ============================================================================

/**
 * Create quest objective
 * @param {Object} config - Objective config
 * @returns {Object} Objective
 */
export function createObjective(config) {
  return {
    id: config.id || aiRng.uniqueId('obj'),
    type: config.type || QUEST_TYPE.KILL,
    description: config.description || "",
    
    // Target
    targetType: config.targetType || null,  // Enemy type, item id, npc id
    targetId: config.targetId || null,      // Specific target
    targetLocation: config.targetLocation || null,
    
    // Progress
    required: config.required || 1,
    current: 0,
    
    // State
    isComplete: false,
    isOptional: config.isOptional ?? false,
    isHidden: config.isHidden ?? false,
    
    // Order
    prerequisiteObjectives: config.prerequisites || [], // Must complete these first
    
    // Rewards for this specific objective
    bonusRewards: config.bonusRewards || null,
  };
}

/**
 * Update objective progress
 * @param {Object} objective - Objective
 * @param {number} amount - Progress to add
 * @returns {boolean} Whether objective completed
 */
export function updateObjectiveProgress(objective, amount = 1) {
  if (objective.isComplete) return false;
  
  objective.current = Math.min(objective.required, objective.current + amount);
  
  if (objective.current >= objective.required) {
    objective.isComplete = true;
    return true;
  }
  
  return false;
}

// ============================================================================
// QUEST
// ============================================================================

/**
 * Create quest
 * @param {Object} config - Quest config
 * @returns {Object} Quest
 */
export function createQuest(config) {
  return {
    id: config.id || aiRng.uniqueId('quest'),
    name: config.name,
    description: config.description || "",
    
    // Classification
    type: config.type || QUEST_TYPE.KILL,
    priority: config.priority || QUEST_PRIORITY.SIDE,
    level: config.level || 1,
    
    // State
    status: QUEST_STATUS.UNAVAILABLE,
    
    // NPCs
    questGiver: config.questGiver || null,
    turnInNpc: config.turnInNpc || config.questGiver,
    
    // Objectives
    objectives: config.objectives || [],
    
    // Prerequisites
    prerequisites: {
      quests: config.requiredQuests || [],     // Quest IDs
      level: config.requiredLevel || 0,
      reputation: config.requiredReputation || {}, // factionId → min rep
      items: config.requiredItems || [],
      flags: config.requiredFlags || [],
    },
    
    // Rewards
    rewards: {
      experience: config.experienceReward || 0,
      gold: config.goldReward || 0,
      items: config.itemRewards || [],        // [{itemId, quantity}]
      reputation: config.reputationRewards || {}, // factionId → amount
      unlocks: config.unlocks || [],          // Quest IDs, abilities, etc.
    },
    
    // Choices/branching
    choices: config.choices || [],  // [{id, description, consequences}]
    selectedChoice: null,
    
    // Timing
    timeLimit: config.timeLimit || null,   // Seconds, null = no limit
    startTime: null,
    
    // Flags
    isRepeatable: config.isRepeatable ?? false,
    completionCount: 0,
    
    // Dialogue
    startDialogue: config.startDialogue || null,
    progressDialogue: config.progressDialogue || null,
    completeDialogue: config.completeDialogue || null,
  };
}

/**
 * Check if quest can be accepted
 * @param {Object} quest - Quest
 * @param {Object} playerState - Player state {level, completedQuests, reputation, inventory, flags}
 * @returns {{canAccept: boolean, missing: Array}}
 */
export function canAcceptQuest(quest, playerState) {
  const missing = [];
  
  // Level check
  if (playerState.level < quest.prerequisites.level) {
    missing.push({ type: "level", required: quest.prerequisites.level, have: playerState.level });
  }
  
  // Quest prerequisites
  for (const reqQuest of quest.prerequisites.quests) {
    if (!playerState.completedQuests?.includes(reqQuest)) {
      missing.push({ type: "quest", questId: reqQuest });
    }
  }
  
  // Reputation
  for (const [factionId, minRep] of Object.entries(quest.prerequisites.reputation)) {
    const playerRep = playerState.reputation?.[factionId] || 0;
    if (playerRep < minRep) {
      missing.push({ type: "reputation", factionId, required: minRep, have: playerRep });
    }
  }
  
  // Items
  for (const itemId of quest.prerequisites.items) {
    if (!playerState.inventory?.includes(itemId)) {
      missing.push({ type: "item", itemId });
    }
  }
  
  // Flags
  for (const flag of quest.prerequisites.flags) {
    if (!playerState.flags?.includes(flag)) {
      missing.push({ type: "flag", flag });
    }
  }
  
  return { canAccept: missing.length === 0, missing };
}

/**
 * Accept quest
 * @param {Object} quest - Quest
 * @returns {boolean} Success
 */
export function acceptQuest(quest) {
  if (quest.status !== QUEST_STATUS.AVAILABLE) return false;
  
  quest.status = QUEST_STATUS.ACTIVE;
  quest.startTime = performance.now();
  
  return true;
}

/**
 * Check quest completion
 * @param {Object} quest - Quest
 * @returns {boolean} Is complete
 */
export function checkQuestComplete(quest) {
  if (quest.status !== QUEST_STATUS.ACTIVE) return false;
  
  // All non-optional objectives must be complete
  for (const obj of quest.objectives) {
    if (!obj.isOptional && !obj.isComplete) {
      return false;
    }
  }
  
  quest.status = QUEST_STATUS.COMPLETE;
  return true;
}

/**
 * Turn in quest and get rewards
 * @param {Object} quest - Quest
 * @returns {Object|null} Rewards or null if can't turn in
 */
export function turnInQuest(quest) {
  if (quest.status !== QUEST_STATUS.COMPLETE) return null;
  
  quest.status = QUEST_STATUS.TURNED_IN;
  quest.completionCount++;
  
  // Reset if repeatable
  if (quest.isRepeatable) {
    quest.status = QUEST_STATUS.AVAILABLE;
    for (const obj of quest.objectives) {
      obj.current = 0;
      obj.isComplete = false;
    }
  }
  
  return { ...quest.rewards };
}

/**
 * Fail quest
 * @param {Object} quest - Quest
 * @param {string} reason - Failure reason
 */
export function failQuest(quest, reason = "unknown") {
  quest.status = QUEST_STATUS.FAILED;
  quest.failReason = reason;
}

// ============================================================================
// QUEST MANAGER
// ============================================================================

/**
 * Create quest manager
 * @returns {Object} Quest manager
 */
export function createQuestManager() {
  return {
    allQuests: new Map(),
    activeQuests: new Map(),
    completedQuests: new Set(),
    failedQuests: new Set(),
    
    // Event tracking for objectives
    pendingEvents: [],
    
    // Quest chains
    chains: new Map(), // chainId → [questIds]
  };
}

/**
 * Register quest
 * @param {Object} manager - Quest manager
 * @param {Object} quest - Quest to register
 */
export function registerQuest(manager, quest) {
  manager.allQuests.set(quest.id, quest);
}

/**
 * Update available quests based on player state
 * @param {Object} manager - Quest manager
 * @param {Object} playerState - Player state
 */
export function updateAvailableQuests(manager, playerState) {
  for (const [id, quest] of manager.allQuests) {
    if (quest.status === QUEST_STATUS.UNAVAILABLE || 
        (quest.isRepeatable && quest.status === QUEST_STATUS.TURNED_IN)) {
      const { canAccept } = canAcceptQuest(quest, playerState);
      if (canAccept) {
        quest.status = QUEST_STATUS.AVAILABLE;
      }
    }
  }
}

/**
 * Report event for quest objectives
 * @param {Object} manager - Quest manager
 * @param {string} eventType - kill, collect, talk, etc.
 * @param {Object} eventData - {targetType, targetId, location, amount}
 * @returns {Array} Updated quests
 */
export function reportQuestEvent(manager, eventType, eventData) {
  const updated = [];
  
  for (const [, quest] of manager.activeQuests) {
    for (const obj of quest.objectives) {
      // Check if objective matches event
      if (obj.isComplete) continue;
      
      let matches = false;
      
      switch (eventType) {
        case "kill":
          matches = obj.type === QUEST_TYPE.KILL && 
            (obj.targetType === eventData.targetType || obj.targetId === eventData.targetId);
          break;
          
        case "collect":
          matches = obj.type === QUEST_TYPE.COLLECT && obj.targetType === eventData.itemId;
          break;
          
        case "talk":
          matches = obj.type === QUEST_TYPE.TALK && obj.targetId === eventData.npcId;
          break;
          
        case "explore":
          matches = obj.type === QUEST_TYPE.EXPLORE && obj.targetLocation === eventData.location;
          break;
          
        case "deliver":
          matches = obj.type === QUEST_TYPE.DELIVER && 
            obj.targetType === eventData.itemId && obj.targetId === eventData.npcId;
          break;
      }
      
      if (matches) {
        const completed = updateObjectiveProgress(obj, eventData.amount || 1);
        if (completed) {
          updated.push({ quest, objective: obj });
          checkQuestComplete(quest);
        }
      }
    }
  }
  
  return updated;
}

// ============================================================================
// PROCEDURAL GENERATION
// ============================================================================

/** Quest templates for generation */
const QUEST_TEMPLATES = {
  kill_creatures: {
    type: QUEST_TYPE.KILL,
    nameTemplates: ["Hunt the {enemy}", "Clear out {location}", "{enemy} Problem"],
    descTemplates: ["Kill {count} {enemy} in {location}."],
    objectives: (params) => [createObjective({
      type: QUEST_TYPE.KILL,
      targetType: params.enemy,
      required: params.count,
      description: `Kill ${params.count} ${params.enemy}`,
    })],
  },
  
  collect_items: {
    type: QUEST_TYPE.COLLECT,
    nameTemplates: ["Gathering {item}", "{item} Collection", "Need for {item}"],
    descTemplates: ["Collect {count} {item} for {npc}."],
    objectives: (params) => [createObjective({
      type: QUEST_TYPE.COLLECT,
      targetType: params.item,
      required: params.count,
      description: `Collect ${params.count} ${params.item}`,
    })],
  },
  
  delivery: {
    type: QUEST_TYPE.DELIVER,
    nameTemplates: ["Delivery to {npc}", "Package for {npc}", "Special Delivery"],
    descTemplates: ["Deliver {item} to {npc} in {location}."],
    objectives: (params) => [createObjective({
      type: QUEST_TYPE.DELIVER,
      targetType: params.item,
      targetId: params.targetNpc,
      targetLocation: params.location,
      description: `Deliver ${params.item} to ${params.targetNpc}`,
    })],
  },
  
  exploration: {
    type: QUEST_TYPE.EXPLORE,
    nameTemplates: ["Scout {location}", "Explore the Unknown", "Discovery"],
    descTemplates: ["Explore {location} and report back."],
    objectives: (params) => [createObjective({
      type: QUEST_TYPE.EXPLORE,
      targetLocation: params.location,
      description: `Explore ${params.location}`,
    })],
  },
  
  bounty: {
    type: QUEST_TYPE.BOUNTY,
    nameTemplates: ["Bounty: {target}", "Wanted: {target}", "Hunt {target}"],
    descTemplates: ["Eliminate {target}. Last seen near {location}."],
    objectives: (params) => [createObjective({
      type: QUEST_TYPE.KILL,
      targetId: params.target,
      required: 1,
      description: `Kill ${params.target}`,
    })],
  },
};

/**
 * Generate procedural quest
 * @param {string} templateId - Template to use
 * @param {Object} params - Generation parameters
 * @param {Object} context - World context for content selection
 * @returns {Object} Generated quest
 */
export function generateQuest(templateId, params, context = {}) {
  const template = QUEST_TEMPLATES[templateId];
  if (!template) return null;
  
  // Select random templates
  const nameTemplate = aiRng.pick(template.nameTemplates);
  const descTemplate = aiRng.pick(template.descTemplates);
  
  // Fill in templates
  const name = fillTemplate(nameTemplate, params);
  const description = fillTemplate(descTemplate, params);
  
  // Generate objectives
  const objectives = template.objectives(params);
  
  // Calculate rewards based on difficulty
  const baseExp = 100;
  const baseGold = 50;
  const difficulty = params.difficulty || 1;
  
  return createQuest({
    id: aiRng.uniqueId('quest'),
    name,
    description,
    type: template.type,
    priority: QUEST_PRIORITY.SIDE,
    level: params.level || 1,
    objectives,
    questGiver: params.questGiver,
    experienceReward: Math.floor(baseExp * difficulty * (params.count || 1)),
    goldReward: Math.floor(baseGold * difficulty * (params.count || 1)),
  });
}

function fillTemplate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, key) => params[key] || match);
}

/**
 * Generate daily quests
 * @param {Object} context - World context
 * @param {number} count - Number of quests
 * @returns {Array<Object>} Generated quests
 */
export function generateDailyQuests(context, count = 3) {
  const quests = [];
  const templates = Object.keys(QUEST_TEMPLATES);
  
  for (let i = 0; i < count; i++) {
    const templateId = aiRng.pick(templates);
    
    // Generate appropriate params based on context
    const params = {
      enemy: aiRng.pick(context.enemies) || "creature",
      item: aiRng.pick(context.items) || "resource",
      location: aiRng.pick(context.locations) || "area",
      npc: aiRng.pick(context.npcs) || "villager",
      targetNpc: aiRng.pick(context.npcs) || "villager",
      target: aiRng.pick(context.bosses) || "boss",
      count: aiRng.intRange(3, 10),
      difficulty: aiRng.range(0.8, 1.2),
      level: context.playerLevel || 1,
    };
    
    const quest = generateQuest(templateId, params, context);
    if (quest) {
      quest.priority = QUEST_PRIORITY.DAILY;
      quest.isRepeatable = false;
      quests.push(quest);
    }
  }
  
  return quests;
}
