// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { aiRng } from './AIRandom.js';

/**
 * AIValues.js - Values, Beliefs, Dreams, and Motivations
 * 
 * Inspired by Dwarf Fortress and Self-Determination Theory:
 * - Core values and beliefs (what they care about)
 * - Life goals and dreams (what they strive for)
 * - Preferences (likes/dislikes)
 * - Cultural values (from their faction/culture)
 * - Psychological needs (Maslow + SDT)
 * - Moral alignment and ethics
 */

// ============================================================================
// CORE VALUES (What they believe in - Dwarf Fortress inspired)
// ============================================================================

/** Value types - things an NPC can care about */
export const VALUE = {
  // Social/Interpersonal
  LAW: "law",                     // Respect for rules and order
  LOYALTY: "loyalty",             // Dedication to group/leader
  FAMILY: "family",               // Blood relations, lineage
  FRIENDSHIP: "friendship",       // Bonds with others
  ROMANCE: "romance",             // Love and partnership
  COOPERATION: "cooperation",     // Working together
  FAIRNESS: "fairness",           // Justice and equality
  
  // Personal Virtues
  TRUTH: "truth",                 // Honesty and transparency
  CUNNING: "cunning",             // Cleverness and guile
  STOICISM: "stoicism",           // Emotional control
  SELF_CONTROL: "self_control",   // Discipline
  PERSEVERANCE: "perseverance",   // Never giving up
  INDEPENDENCE: "independence",   // Self-reliance
  INTROSPECTION: "introspection", // Self-reflection
  
  // Accomplishment
  HARD_WORK: "hard_work",         // Effort and dedication
  SKILL: "skill",                 // Mastery and expertise
  CRAFTSMANSHIP: "craftsmanship", // Quality of creation
  MARTIAL_PROWESS: "martial",     // Combat excellence
  KNOWLEDGE: "knowledge",         // Learning and wisdom
  ARTWORK: "artwork",             // Artistic expression
  
  // Social Status
  POWER: "power",                 // Authority and control
  ELOQUENCE: "eloquence",         // Speaking ability
  DECORUM: "decorum",             // Proper behavior
  TRADITION: "tradition",         // Respecting customs
  COMPETITION: "competition",     // Desire to win
  COMMERCE: "commerce",           // Trade and wealth
  
  // Lifestyle
  TRANQUILITY: "tranquility",     // Peace and calm
  HARMONY: "harmony",             // Balance with others
  MERRIMENT: "merriment",         // Joy and celebration
  LEISURE: "leisure",             // Rest and relaxation
  NATURE: "nature",               // Connection to natural world
  PEACE: "peace",                 // Absence of conflict
  SACRIFICE: "sacrifice",         // Giving for others
};

/** Value strength levels */
export const VALUE_LEVEL = {
  ABHORS: -3,           // Utterly despises this value
  OPPOSES: -2,          // Strongly against
  DISLIKES: -1,         // Mildly against
  NEUTRAL: 0,           // No strong feelings
  APPRECIATES: 1,       // Mildly supportive
  VALUES: 2,            // Strongly supportive
  REVERES: 3,           // Holds as highest ideal
};

// ============================================================================
// LIFE GOALS AND DREAMS
// ============================================================================

/** Types of life goals */
export const GOAL_TYPE = {
  // Achievement
  MASTER_SKILL: "master_skill",           // Become expert at something
  CREATE_MASTERWORK: "create_masterwork", // Make something great
  GAIN_FAME: "gain_fame",                 // Become renowned
  AMASS_WEALTH: "amass_wealth",           // Get rich
  ATTAIN_POWER: "attain_power",           // Gain authority
  
  // Social
  FIND_LOVE: "find_love",                 // Find romantic partner
  START_FAMILY: "start_family",           // Have children
  MAKE_FRIENDS: "make_friends",           // Build friendships
  LEAD_OTHERS: "lead_others",             // Become a leader
  MENTOR_OTHERS: "mentor_others",         // Teach and guide
  
  // Adventure
  SEE_THE_WORLD: "see_world",             // Travel and explore
  SLAY_MONSTER: "slay_monster",           // Kill a great beast
  FIND_ARTIFACT: "find_artifact",         // Discover something legendary
  SURVIVE_DANGER: "survive_danger",       // Overcome great peril
  
  // Personal
  FIND_PURPOSE: "find_purpose",           // Discover meaning
  OVERCOME_FEAR: "overcome_fear",         // Conquer a phobia
  AVENGE_WRONG: "avenge_wrong",           // Get revenge
  REDEMPTION: "redemption",               // Atone for past
  ENLIGHTENMENT: "enlightenment",         // Spiritual growth
  
  // Legacy
  BUILD_MONUMENT: "build_monument",       // Create lasting structure
  FOUND_ORGANIZATION: "found_org",        // Start a group
  WRITE_BOOK: "write_book",               // Record knowledge
  LEAVE_LEGACY: "leave_legacy",           // Be remembered
};

/** Goal status */
export const GOAL_STATUS = {
  DREAMED: "dreamed",       // Wants but hasn't started
  PURSUING: "pursuing",     // Actively working on
  ACHIEVED: "achieved",     // Successfully completed
  ABANDONED: "abandoned",   // Given up
  FAILED: "failed",         // Cannot be achieved
};

// ============================================================================
// PSYCHOLOGICAL NEEDS (Maslow + Self-Determination Theory)
// ============================================================================

/** Higher-order psychological needs */
export const PSYCH_NEED = {
  // Self-Determination Theory (SDT)
  AUTONOMY: "autonomy",           // Control over own life
  COMPETENCE: "competence",       // Feeling capable
  RELATEDNESS: "relatedness",     // Connection to others
  
  // Maslow's Higher Levels
  ESTEEM: "esteem",               // Self-respect and recognition
  BELONGING: "belonging",         // Being part of group
  SELF_ACTUALIZATION: "self_actualization", // Reaching potential
  
  // Additional Psychological Needs
  MEANING: "meaning",             // Purpose in life
  SECURITY: "security",           // Feeling safe from threats
  NOVELTY: "novelty",             // New experiences
  ACHIEVEMENT: "achievement",     // Accomplishing goals
  RECOGNITION: "recognition",     // Being acknowledged
  CREATIVITY: "creativity",       // Self-expression
  INTIMACY: "intimacy",           // Deep connections
  JUSTICE: "justice",             // Fairness in the world
};

// ============================================================================
// PREFERENCES (Likes and Dislikes)
// ============================================================================

/** Preference categories */
export const PREF_CATEGORY = {
  MATERIAL: "material",     // Wood, metal, stone
  COLOR: "color",           // Red, blue, green
  CREATURE: "creature",     // Animals, monsters
  FOOD: "food",             // Foods and drinks
  WEATHER: "weather",       // Rain, sun, snow
  ACTIVITY: "activity",     // Fighting, crafting, talking
  LOCATION: "location",     // Mountains, forests, cities
  ITEM: "item",             // Weapons, tools, clothes
};

// ============================================================================
// VALUE SYSTEM
// ============================================================================

/**
 * Create NPC values system
 * @param {Object} config - Configuration
 * @returns {Object} Values system
 */
export function createValueSystem(config = {}) {
  const values = {};
  
  // Initialize all values to neutral
  for (const value of Object.values(VALUE)) {
    values[value] = VALUE_LEVEL.NEUTRAL;
  }
  
  // Apply provided values
  if (config.values) {
    for (const [key, level] of Object.entries(config.values)) {
      if (values[key] !== undefined) {
        values[key] = level;
      }
    }
  }
  
  return {
    values,
    
    // Cultural baseline (from faction)
    culturalValues: config.culturalValues || {},
    
    // Goals
    lifeGoals: config.goals || [],
    
    // Psychological needs satisfaction (0-1)
    psychNeeds: initializePsychNeeds(config.psychNeeds),
    
    // Preferences
    likes: config.likes || [],
    dislikes: config.dislikes || [],
    
    // Moral alignment
    morality: {
      goodEvil: config.goodEvil ?? 0,     // -1 evil to 1 good
      lawChaos: config.lawChaos ?? 0,     // -1 chaotic to 1 lawful
    },
    
    // Values that conflict with personality (causes internal struggle)
    conflicts: [],
  };
}

/**
 * Initialize psychological needs
 */
function initializePsychNeeds(initial = {}) {
  const needs = {};
  for (const need of Object.values(PSYCH_NEED)) {
    needs[need] = {
      satisfaction: initial[need] ?? 0.5,
      importance: 0.5, // How much this NPC cares about this need
      lastSatisfied: 0,
    };
  }
  return needs;
}

/**
 * Create a life goal
 * @param {Object} config - Goal config
 * @returns {Object} Life goal
 */
export function createLifeGoal(config) {
  return {
    id: config.id || aiRng.uniqueId('goal'),
    type: config.type,
    description: config.description || "",
    
    // Target (specific thing to achieve)
    target: config.target || null,  // e.g., skill name, person, location
    targetValue: config.targetValue || null, // e.g., skill level 100
    
    // Progress
    status: config.status || GOAL_STATUS.DREAMED,
    progress: config.progress || 0, // 0-1
    
    // Importance to the NPC
    importance: config.importance ?? 0.5, // 0-1
    
    // When achieved
    achievedTime: null,
    
    // Related values (pursuing this satisfies these values)
    relatedValues: config.relatedValues || [],
  };
}

// ============================================================================
// VALUE OPERATIONS
// ============================================================================

/**
 * Get value strength
 * @param {Object} system - Value system
 * @param {string} value - Value type
 * @returns {number} Strength (-3 to 3)
 */
export function getValue(system, value) {
  return system.values[value] ?? VALUE_LEVEL.NEUTRAL;
}

/**
 * Set value strength
 * @param {Object} system - Value system
 * @param {string} value - Value type
 * @param {number} level - New level
 */
export function setValue(system, value, level) {
  if (system.values[value] !== undefined) {
    system.values[value] = Math.max(-3, Math.min(3, level));
    checkForValueConflicts(system);
  }
}

/**
 * Modify value (shift toward a direction)
 * @param {Object} system - Value system
 * @param {string} value - Value type
 * @param {number} delta - Change amount
 */
export function modifyValue(system, value, delta) {
  if (system.values[value] !== undefined) {
    system.values[value] = Math.max(-3, Math.min(3, system.values[value] + delta));
    checkForValueConflicts(system);
  }
}

/**
 * Check if NPC values something
 * @param {Object} system - Value system
 * @param {string} value - Value type
 * @returns {boolean} Values it positively
 */
export function valuesPositively(system, value) {
  return getValue(system, value) > 0;
}

/**
 * Get top values (what they care about most)
 * @param {Object} system - Value system
 * @param {number} count - How many to return
 * @returns {Array<{value: string, level: number}>}
 */
export function getTopValues(system, count = 5) {
  return Object.entries(system.values)
    .map(([value, level]) => ({ value, level }))
    .filter(v => v.level !== 0)
    .sort((a, b) => Math.abs(b.level) - Math.abs(a.level))
    .slice(0, count);
}

/**
 * Check for conflicts between values and personality
 */
function checkForValueConflicts(system) {
  system.conflicts = [];
  // This would check against personality facets
  // For now, check opposing values
  const opposites = [
    [VALUE.LAW, VALUE.INDEPENDENCE],
    [VALUE.TRADITION, VALUE.CUNNING],
    [VALUE.COOPERATION, VALUE.COMPETITION],
    [VALUE.TRANQUILITY, VALUE.MERRIMENT],
    [VALUE.STOICISM, VALUE.ROMANCE],
  ];
  
  for (const [a, b] of opposites) {
    if (system.values[a] > 1 && system.values[b] > 1) {
      system.conflicts.push({ values: [a, b], severity: Math.min(system.values[a], system.values[b]) });
    }
  }
}

// ============================================================================
// PSYCHOLOGICAL NEEDS
// ============================================================================

/**
 * Update psychological need
 * @param {Object} system - Value system
 * @param {string} need - Need type
 * @param {number} delta - Change in satisfaction
 */
export function satisfyPsychNeed(system, need, delta) {
  if (system.psychNeeds[need]) {
    system.psychNeeds[need].satisfaction = Math.max(0, Math.min(1, 
      system.psychNeeds[need].satisfaction + delta
    ));
    system.psychNeeds[need].lastSatisfied = performance.now();
  }
}

/**
 * Decay psychological needs over time
 * @param {Object} system - Value system
 * @param {number} deltaTime - Time elapsed in seconds
 */
export function decayPsychNeeds(system, deltaTime) {
  const decayRate = 0.01; // Per second base
  
  for (const need of Object.values(PSYCH_NEED)) {
    const data = system.psychNeeds[need];
    if (data) {
      // Decay faster for more important needs
      const decay = decayRate * deltaTime * (0.5 + data.importance * 0.5);
      data.satisfaction = Math.max(0, data.satisfaction - decay);
    }
  }
}

/**
 * Get most deprived psychological need
 * @param {Object} system - Value system
 * @returns {{need: string, satisfaction: number, importance: number}}
 */
export function getMostDeprivedNeed(system) {
  let lowest = null;
  let lowestScore = Infinity;
  
  for (const [need, data] of Object.entries(system.psychNeeds)) {
    // Score = satisfaction / importance (lower = more deprived for important needs)
    const score = data.satisfaction / (data.importance + 0.1);
    if (score < lowestScore) {
      lowestScore = score;
      lowest = { need, ...data };
    }
  }
  
  return lowest;
}

/**
 * Calculate overall psychological wellbeing
 * @param {Object} system - Value system
 * @returns {number} Wellbeing 0-1
 */
export function calculateWellbeing(system) {
  let total = 0;
  let weight = 0;
  
  for (const [, data] of Object.entries(system.psychNeeds)) {
    total += data.satisfaction * data.importance;
    weight += data.importance;
  }
  
  return weight > 0 ? total / weight : 0.5;
}

// ============================================================================
// LIFE GOALS
// ============================================================================

/**
 * Add life goal
 * @param {Object} system - Value system
 * @param {Object} goal - Goal to add
 */
export function addLifeGoal(system, goal) {
  // Check for duplicates
  if (!system.lifeGoals.find(g => g.type === goal.type && g.target === goal.target)) {
    system.lifeGoals.push(goal);
  }
}

/**
 * Update goal progress
 * @param {Object} system - Value system
 * @param {string} goalId - Goal ID
 * @param {number} progress - New progress (0-1)
 */
export function updateGoalProgress(system, goalId, progress) {
  const goal = system.lifeGoals.find(g => g.id === goalId);
  if (goal) {
    goal.progress = Math.max(0, Math.min(1, progress));
    
    if (goal.progress >= 1 && goal.status === GOAL_STATUS.PURSUING) {
      goal.status = GOAL_STATUS.ACHIEVED;
      goal.achievedTime = performance.now();
    }
  }
}

/**
 * Start pursuing a goal
 * @param {Object} system - Value system
 * @param {string} goalId - Goal ID
 */
export function pursueGoal(system, goalId) {
  const goal = system.lifeGoals.find(g => g.id === goalId);
  if (goal && goal.status === GOAL_STATUS.DREAMED) {
    goal.status = GOAL_STATUS.PURSUING;
  }
}

/**
 * Get active goals being pursued
 * @param {Object} system - Value system
 * @returns {Array<Object>} Active goals
 */
export function getActiveGoals(system) {
  return system.lifeGoals.filter(g => g.status === GOAL_STATUS.PURSUING);
}

/**
 * Get unfulfilled dreams
 * @param {Object} system - Value system
 * @returns {Array<Object>} Dreams
 */
export function getUnfulfilledDreams(system) {
  return system.lifeGoals.filter(g => 
    g.status === GOAL_STATUS.DREAMED || g.status === GOAL_STATUS.PURSUING
  );
}

// ============================================================================
// DECISION MAKING BASED ON VALUES
// ============================================================================

/**
 * Score an action based on values
 * @param {Object} system - Value system
 * @param {Object} action - {affects: {value: impact}}
 * @returns {number} Score (higher = more aligned with values)
 */
export function scoreActionByValues(system, action) {
  let score = 0;
  
  if (action.affects) {
    for (const [value, impact] of Object.entries(action.affects)) {
      const valueLevel = getValue(system, value);
      // Positive value + positive impact = good
      // Positive value + negative impact = bad
      score += valueLevel * impact;
    }
  }
  
  // Consider morality
  if (action.moralImpact) {
    score += action.moralImpact.good * system.morality.goodEvil;
    score += action.moralImpact.lawful * system.morality.lawChaos;
  }
  
  return score;
}

/**
 * Would NPC do this action based on values?
 * @param {Object} system - Value system
 * @param {Object} action - Action with value impacts
 * @param {number} threshold - Minimum score to accept
 * @returns {{wouldDo: boolean, score: number, reason: string}}
 */
export function wouldDoAction(system, action, threshold = 0) {
  const score = scoreActionByValues(system, action);
  
  let reason = "";
  if (score > threshold) {
    const aligned = Object.entries(action.affects || {})
      .filter(([v, i]) => getValue(system, v) * i > 0)
      .map(([v]) => v);
    reason = aligned.length > 0 ? `Aligns with ${aligned.join(", ")}` : "Acceptable";
  } else {
    const opposed = Object.entries(action.affects || {})
      .filter(([v, i]) => getValue(system, v) * i < 0)
      .map(([v]) => v);
    reason = opposed.length > 0 ? `Violates ${opposed.join(", ")}` : "Against principles";
  }
  
  return { wouldDo: score > threshold, score, reason };
}

// ============================================================================
// PRESETS
// ============================================================================

/** Value presets for quick character creation */
export const VALUE_PRESETS = {
  hero: {
    values: {
      [VALUE.LOYALTY]: 2, [VALUE.FAIRNESS]: 2, [VALUE.SACRIFICE]: 2,
      [VALUE.MARTIAL_PROWESS]: 1, [VALUE.TRUTH]: 1,
    },
    goodEvil: 0.7, lawChaos: 0.3,
  },
  
  villain: {
    values: {
      [VALUE.POWER]: 3, [VALUE.CUNNING]: 2, [VALUE.COMPETITION]: 2,
      [VALUE.FAIRNESS]: -2, [VALUE.SACRIFICE]: -2,
    },
    goodEvil: -0.7, lawChaos: -0.3,
  },
  
  merchant: {
    values: {
      [VALUE.COMMERCE]: 3, [VALUE.CUNNING]: 1, [VALUE.HARD_WORK]: 1,
      [VALUE.FAIRNESS]: 1, [VALUE.FRIENDSHIP]: 1,
    },
    goodEvil: 0, lawChaos: 0.2,
  },
  
  scholar: {
    values: {
      [VALUE.KNOWLEDGE]: 3, [VALUE.TRUTH]: 2, [VALUE.INTROSPECTION]: 2,
      [VALUE.TRANQUILITY]: 1, [VALUE.CRAFTSMANSHIP]: 1,
    },
    goodEvil: 0.2, lawChaos: 0.1,
  },
  
  soldier: {
    values: {
      [VALUE.LOYALTY]: 3, [VALUE.LAW]: 2, [VALUE.MARTIAL_PROWESS]: 2,
      [VALUE.TRADITION]: 1, [VALUE.STOICISM]: 1,
    },
    goodEvil: 0, lawChaos: 0.8,
  },
  
  rebel: {
    values: {
      [VALUE.INDEPENDENCE]: 3, [VALUE.FAIRNESS]: 2, [VALUE.CUNNING]: 1,
      [VALUE.LAW]: -2, [VALUE.TRADITION]: -1,
    },
    goodEvil: 0.1, lawChaos: -0.8,
  },
  
  hermit: {
    values: {
      [VALUE.TRANQUILITY]: 3, [VALUE.NATURE]: 2, [VALUE.INDEPENDENCE]: 2,
      [VALUE.INTROSPECTION]: 2, [VALUE.MERRIMENT]: -1,
    },
    goodEvil: 0, lawChaos: 0,
  },
  
  artist: {
    values: {
      [VALUE.ARTWORK]: 3, [VALUE.CRAFTSMANSHIP]: 2, [VALUE.ROMANCE]: 1,
      [VALUE.MERRIMENT]: 1, [VALUE.HARD_WORK]: 1,
    },
    goodEvil: 0.1, lawChaos: -0.2,
  },
};

/**
 * Create value system from preset
 * @param {string} preset - Preset name
 * @returns {Object} Value system
 */
export function createFromPreset(preset) {
  const data = VALUE_PRESETS[preset];
  if (!data) return createValueSystem();
  
  return createValueSystem({
    values: data.values,
    goodEvil: data.goodEvil,
    lawChaos: data.lawChaos,
  });
}
