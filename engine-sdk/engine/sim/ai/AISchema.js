// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AISchema.js - Unified JSON Schema for AI System
 * 
 * Defines consistent data structures for:
 * - Behavior tree node types
 * - Perception parameters (vision, hearing)
 * - Awareness states
 * - Steering agent configs
 * - Faction/reputation systems
 * - NPC personality traits
 * 
 * All AI code should use these schemas for consistency.
 */

// ============================================================================
// BEHAVIOR TREE
// ============================================================================

/**
 * Behavior tree node status
 */
export const NODE_STATUS = {
  success: { id: 0, label: "Success", desc: "Node completed successfully" },
  failure: { id: 1, label: "Failure", desc: "Node failed" },
  running: { id: 2, label: "Running", desc: "Node still executing" },
};

/**
 * Behavior tree node types
 */
export const NODE_TYPES = {
  // Composite nodes
  selector: { id: 0, label: "Selector", desc: "OR logic - succeeds if any child succeeds", category: "composite" },
  sequence: { id: 1, label: "Sequence", desc: "AND logic - fails if any child fails", category: "composite" },
  parallel: { id: 2, label: "Parallel", desc: "Runs all children simultaneously", category: "composite" },
  randomSelector: { id: 3, label: "Random Selector", desc: "Randomly picks child order", category: "composite" },
  
  // Decorator nodes
  inverter: { id: 10, label: "Inverter", desc: "Inverts child result", category: "decorator" },
  repeater: { id: 11, label: "Repeater", desc: "Repeats child N times", category: "decorator" },
  succeeder: { id: 12, label: "Succeeder", desc: "Always returns success", category: "decorator" },
  failer: { id: 13, label: "Failer", desc: "Always returns failure", category: "decorator" },
  untilFail: { id: 14, label: "Until Fail", desc: "Repeats until child fails", category: "decorator" },
  cooldown: { id: 15, label: "Cooldown", desc: "Adds delay between executions", category: "decorator" },
  
  // Leaf nodes
  action: { id: 20, label: "Action", desc: "Executes an action", category: "leaf" },
  condition: { id: 21, label: "Condition", desc: "Tests a condition", category: "leaf" },
  wait: { id: 22, label: "Wait", desc: "Waits for duration", category: "leaf" },
  log: { id: 23, label: "Log", desc: "Debug logging", category: "leaf" },
};

/**
 * Get node type ID from name
 */
export function getNodeTypeId(typeName) {
  return NODE_TYPES[typeName]?.id ?? NODE_TYPES.action.id;
}

// ============================================================================
// AWARENESS STATES
// ============================================================================

/**
 * NPC awareness states
 */
export const AWARENESS_STATES = {
  unaware: { id: 0, label: "Unaware", desc: "No knowledge of threats", color: [0, 1, 0] },
  suspicious: { id: 1, label: "Suspicious", desc: "Heard something, investigating", color: [1, 1, 0] },
  alert: { id: 2, label: "Alert", desc: "Knows threat exists, searching", color: [1, 0.5, 0] },
  combat: { id: 3, label: "Combat", desc: "Actively engaged", color: [1, 0, 0] },
};

/**
 * Get awareness state ID from name
 */
export function getAwarenessStateId(stateName) {
  return AWARENESS_STATES[stateName]?.id ?? AWARENESS_STATES.unaware.id;
}

/**
 * Get awareness state name from ID
 */
export function getAwarenessStateName(stateId) {
  for (const [name, state] of Object.entries(AWARENESS_STATES)) {
    if (state.id === stateId) return name;
  }
  return "unaware";
}

// ============================================================================
// SENSE TYPES
// ============================================================================

/**
 * Sense types for perception
 */
export const SENSE_TYPES = {
  sight: { id: 0, label: "Sight", desc: "Visual detection", range: 30 },
  hearing: { id: 1, label: "Hearing", desc: "Audio detection", range: 25 },
  damage: { id: 2, label: "Damage", desc: "Pain/damage detection", range: 0 },
  touch: { id: 3, label: "Touch", desc: "Physical contact", range: 1 },
  smell: { id: 4, label: "Smell", desc: "Scent detection", range: 15 },
  teamShare: { id: 5, label: "Team Share", desc: "Shared knowledge from allies", range: 50 },
};

// ============================================================================
// PERCEPTION SCHEMA
// ============================================================================

/**
 * Perception parameters schema
 */
export const PERCEPTION_SCHEMA = {
  name: "Perception",
  fields: {
    // Vision
    visionRange: { type: "number", default: 30, min: 0, desc: "Max vision distance" },
    visionFOVDeg: { type: "number", default: 110, min: 0, max: 360, desc: "Vision cone FOV (degrees)" },
    peripheralFOVDeg: { type: "number", default: 160, min: 0, max: 360, desc: "Peripheral vision FOV" },
    peripheralRangeMult: { type: "number", default: 0.5, min: 0, max: 1, desc: "Peripheral range multiplier" },
    
    // Hearing
    hearingRange: { type: "number", default: 25, min: 0, desc: "Max hearing distance" },
    
    // Awareness thresholds (0-1)
    suspiciousThreshold: { type: "number", default: 0.3, min: 0, max: 1, desc: "Threshold to become suspicious" },
    alertThreshold: { type: "number", default: 0.6, min: 0, max: 1, desc: "Threshold to become alert" },
    combatThreshold: { type: "number", default: 0.9, min: 0, max: 1, desc: "Threshold to enter combat" },
    
    // Decay rates
    awarenessDecayRate: { type: "number", default: 0.1, min: 0, desc: "Awareness decay per second" },
    memoryDuration: { type: "number", default: 10000, min: 0, desc: "Memory duration (ms)" },
    
    // Detection speed
    detectionRate: { type: "number", default: 2.0, min: 0, desc: "Awareness gain per second" },
    investigationTime: { type: "number", default: 5000, min: 0, desc: "Time to investigate (ms)" },
  },
};

// ============================================================================
// STEERING SCHEMA
// ============================================================================

/**
 * Steering behavior types
 */
export const STEERING_BEHAVIORS = {
  seek: { id: 0, label: "Seek", desc: "Move towards target" },
  flee: { id: 1, label: "Flee", desc: "Move away from target" },
  arrive: { id: 2, label: "Arrive", desc: "Decelerate to stop at target" },
  pursue: { id: 3, label: "Pursue", desc: "Intercept moving target" },
  evade: { id: 4, label: "Evade", desc: "Avoid moving target" },
  wander: { id: 5, label: "Wander", desc: "Random wandering" },
  avoidObstacles: { id: 6, label: "Avoid Obstacles", desc: "Steer around obstacles" },
  separation: { id: 7, label: "Separation", desc: "Maintain distance from neighbors" },
  alignment: { id: 8, label: "Alignment", desc: "Match neighbor heading" },
  cohesion: { id: 9, label: "Cohesion", desc: "Move toward neighbor center" },
  pathFollow: { id: 10, label: "Path Follow", desc: "Follow a path" },
  flowField: { id: 11, label: "Flow Field", desc: "Follow flow field" },
};

/**
 * Steering agent schema
 */
export const STEERING_AGENT_SCHEMA = {
  name: "SteeringAgent",
  fields: {
    maxSpeed: { type: "number", default: 10, min: 0, desc: "Maximum speed" },
    maxForce: { type: "number", default: 5, min: 0, desc: "Maximum steering force" },
    mass: { type: "number", default: 1, min: 0.001, desc: "Agent mass" },
    
    // Wander parameters
    wanderRadius: { type: "number", default: 2, min: 0, desc: "Wander circle radius" },
    wanderDistance: { type: "number", default: 4, min: 0, desc: "Wander circle distance" },
    wanderJitter: { type: "number", default: 0.5, min: 0, desc: "Wander angle jitter" },
    
    // Avoidance parameters
    avoidanceRadius: { type: "number", default: 3, min: 0, desc: "Obstacle detection radius" },
    lookAheadDistance: { type: "number", default: 5, min: 0, desc: "Look ahead distance" },
    
    // Flocking parameters
    separationWeight: { type: "number", default: 1.5, min: 0, desc: "Separation force weight" },
    alignmentWeight: { type: "number", default: 1.0, min: 0, desc: "Alignment force weight" },
    cohesionWeight: { type: "number", default: 1.0, min: 0, desc: "Cohesion force weight" },
    neighborRadius: { type: "number", default: 10, min: 0, desc: "Flocking neighbor radius" },
  },
};

// ============================================================================
// FACTION SCHEMA
// ============================================================================

/**
 * Diplomatic stances
 */
export const DIPLOMATIC_STANCES = {
  war: { id: -3, label: "War", desc: "Active warfare", canTrade: false, canEnterTerritory: false },
  hostile: { id: -2, label: "Hostile", desc: "Hostile relations", canTrade: false, canEnterTerritory: false },
  unfriendly: { id: -1, label: "Unfriendly", desc: "Tense relations", canTrade: true, canEnterTerritory: false },
  neutral: { id: 0, label: "Neutral", desc: "No special relations", canTrade: true, canEnterTerritory: true },
  friendly: { id: 1, label: "Friendly", desc: "Good relations", canTrade: true, canEnterTerritory: true },
  allied: { id: 2, label: "Allied", desc: "Military alliance", canTrade: true, canEnterTerritory: true },
  vassal: { id: 3, label: "Vassal", desc: "Subservient faction", canTrade: true, canEnterTerritory: true },
};

/**
 * Reputation levels
 */
export const REPUTATION_LEVELS = {
  hated: { min: -1000, max: -500, id: 0, label: "Hated", color: [0.5, 0, 0] },
  hostile: { min: -500, max: -200, id: 1, label: "Hostile", color: [0.8, 0, 0] },
  unfriendly: { min: -200, max: -50, id: 2, label: "Unfriendly", color: [1, 0.3, 0] },
  neutral: { min: -50, max: 50, id: 3, label: "Neutral", color: [1, 1, 0] },
  friendly: { min: 50, max: 200, id: 4, label: "Friendly", color: [0.5, 1, 0] },
  honored: { min: 200, max: 500, id: 5, label: "Honored", color: [0, 1, 0] },
  revered: { min: 500, max: 1000, id: 6, label: "Revered", color: [0, 0.8, 1] },
  exalted: { min: 1000, max: Infinity, id: 7, label: "Exalted", color: [1, 0.8, 0] },
};

/**
 * Get reputation level from value
 */
export function getReputationLevel(value) {
  for (const [name, level] of Object.entries(REPUTATION_LEVELS)) {
    if (value >= level.min && value < level.max) return name;
  }
  return "neutral";
}

/**
 * Faction schema
 */
export const FACTION_SCHEMA = {
  name: "Faction",
  fields: {
    id: { type: "string", required: true, desc: "Unique faction ID" },
    name: { type: "string", required: true, desc: "Display name" },
    description: { type: "string", default: "", desc: "Faction description" },
    color: { type: "vec3", default: [0.5, 0.5, 0.5], desc: "Faction color" },
    isPlayer: { type: "boolean", default: false, desc: "Is player faction" },
    isHidden: { type: "boolean", default: false, desc: "Hidden from UI" },
  },
};

// ============================================================================
// PERSONALITY SCHEMA
// ============================================================================

/**
 * Personality traits (Big Five + custom)
 */
export const PERSONALITY_TRAITS = {
  // Big Five
  openness: { id: 0, label: "Openness", desc: "Curiosity, creativity", range: [-1, 1] },
  conscientiousness: { id: 1, label: "Conscientiousness", desc: "Organization, dependability", range: [-1, 1] },
  extraversion: { id: 2, label: "Extraversion", desc: "Sociability, assertiveness", range: [-1, 1] },
  agreeableness: { id: 3, label: "Agreeableness", desc: "Cooperation, trust", range: [-1, 1] },
  neuroticism: { id: 4, label: "Neuroticism", desc: "Emotional instability", range: [-1, 1] },
  
  // Combat traits
  aggression: { id: 10, label: "Aggression", desc: "Tendency to attack", range: [0, 1] },
  bravery: { id: 11, label: "Bravery", desc: "Willingness to fight", range: [0, 1] },
  caution: { id: 12, label: "Caution", desc: "Risk avoidance", range: [0, 1] },
  loyalty: { id: 13, label: "Loyalty", desc: "Team commitment", range: [0, 1] },
};

/**
 * Personality schema
 */
export const PERSONALITY_SCHEMA = {
  name: "Personality",
  fields: {
    openness: { type: "number", default: 0, min: -1, max: 1 },
    conscientiousness: { type: "number", default: 0, min: -1, max: 1 },
    extraversion: { type: "number", default: 0, min: -1, max: 1 },
    agreeableness: { type: "number", default: 0, min: -1, max: 1 },
    neuroticism: { type: "number", default: 0, min: -1, max: 1 },
    aggression: { type: "number", default: 0.5, min: 0, max: 1 },
    bravery: { type: "number", default: 0.5, min: 0, max: 1 },
    caution: { type: "number", default: 0.5, min: 0, max: 1 },
    loyalty: { type: "number", default: 0.5, min: 0, max: 1 },
  },
};

// ============================================================================
// NPC SCHEMA
// ============================================================================

/**
 * Complete NPC AI schema
 */
export const NPC_AI_SCHEMA = {
  name: "NpcAI",
  fields: {
    // Identity
    factionId: { type: "string", default: "neutral", desc: "Faction membership" },
    role: { type: "string", default: "civilian", desc: "NPC role/class" },
    
    // State
    awarenessState: { type: "enum", enum: Object.keys(AWARENESS_STATES), default: "unaware" },
    currentTarget: { type: "any", default: null, desc: "Current target entity" },
    lastKnownTargetPos: { type: "vec3", default: null, desc: "Last known target position" },
    
    // Combat
    combatStyle: { type: "string", default: "balanced", desc: "Combat behavior style" },
    preferredRange: { type: "number", default: 5, min: 0, desc: "Preferred combat range" },
    
    // Movement
    patrolRoute: { type: "array", default: [], desc: "Patrol waypoints" },
    homePosition: { type: "vec3", default: null, desc: "Home/spawn position" },
    wanderRadius: { type: "number", default: 10, min: 0, desc: "Wander distance from home" },
  },
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate perception parameters
 */
export function validatePerception(config) {
  const errors = [];
  const result = { ...config };
  const schema = PERCEPTION_SCHEMA.fields;
  
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined) {
      result[key] = field.default;
    } else if (typeof result[key] !== "number") {
      result[key] = field.default;
      errors.push(`Invalid ${key}: expected number`);
    } else {
      if (field.min !== undefined && result[key] < field.min) result[key] = field.min;
      if (field.max !== undefined && result[key] > field.max) result[key] = field.max;
    }
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate steering agent config
 */
export function validateSteeringAgent(config) {
  const errors = [];
  const result = { ...config };
  const schema = STEERING_AGENT_SCHEMA.fields;
  
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined) {
      result[key] = field.default;
    } else if (typeof result[key] !== "number") {
      result[key] = field.default;
      errors.push(`Invalid ${key}: expected number`);
    } else {
      if (field.min !== undefined && result[key] < field.min) result[key] = field.min;
    }
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate personality
 */
export function validatePersonality(config) {
  const errors = [];
  const result = { ...config };
  const schema = PERSONALITY_SCHEMA.fields;
  
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined) {
      result[key] = field.default;
    } else if (typeof result[key] !== "number") {
      result[key] = field.default;
    } else {
      result[key] = Math.max(field.min, Math.min(field.max, result[key]));
    }
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create default perception config
 */
export function createDefaultPerception() {
  const result = {};
  for (const [key, field] of Object.entries(PERCEPTION_SCHEMA.fields)) {
    result[key] = field.default;
  }
  return result;
}

/**
 * Create default steering agent
 */
export function createDefaultSteeringAgent() {
  return {
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    acceleration: [0, 0, 0],
    maxSpeed: 10,
    maxForce: 5,
    mass: 1,
    wanderAngle: 0,
    wanderRadius: 2,
    wanderDistance: 4,
    wanderJitter: 0.5,
    avoidanceRadius: 3,
    lookAheadDistance: 5,
  };
}

/**
 * Create default personality
 */
export function createDefaultPersonality() {
  const result = {};
  for (const [key, field] of Object.entries(PERSONALITY_SCHEMA.fields)) {
    result[key] = field.default;
  }
  return result;
}

/**
 * Create default faction
 */
export function createDefaultFaction(id, name) {
  return {
    id,
    name,
    description: "",
    color: [0.5, 0.5, 0.5],
    isPlayer: false,
    isHidden: false,
    relations: new Map(),
  };
}

/**
 * Create preset personality
 */
export const PERSONALITY_PRESETS = {
  aggressive: { openness: -0.3, conscientiousness: -0.2, extraversion: 0.5, agreeableness: -0.7, neuroticism: 0.4, aggression: 0.9, bravery: 0.7, caution: 0.2, loyalty: 0.5 },
  cautious: { openness: 0.2, conscientiousness: 0.6, extraversion: -0.3, agreeableness: 0.3, neuroticism: 0.3, aggression: 0.2, bravery: 0.4, caution: 0.9, loyalty: 0.7 },
  brave: { openness: 0.4, conscientiousness: 0.3, extraversion: 0.6, agreeableness: 0.2, neuroticism: -0.4, aggression: 0.5, bravery: 0.95, caution: 0.3, loyalty: 0.8 },
  coward: { openness: -0.2, conscientiousness: 0.1, extraversion: -0.5, agreeableness: 0.4, neuroticism: 0.7, aggression: 0.1, bravery: 0.1, caution: 0.95, loyalty: 0.3 },
  loyal: { openness: 0.1, conscientiousness: 0.7, extraversion: 0.2, agreeableness: 0.6, neuroticism: 0.1, aggression: 0.4, bravery: 0.6, caution: 0.5, loyalty: 0.95 },
  berserker: { openness: -0.5, conscientiousness: -0.6, extraversion: 0.8, agreeableness: -0.8, neuroticism: 0.6, aggression: 1.0, bravery: 0.9, caution: 0.0, loyalty: 0.4 },
};
