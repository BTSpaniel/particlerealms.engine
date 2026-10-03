// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIPersonality.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';
import { statsMean } from '../../core/math/MathStatistics.js';

/**
 * AIPersonality.js (original) - Personality, Emotions, and Relationships
 * 
 * Based on psychological models:
 * - Big Five personality traits (OCEAN)
 * - Plutchik's wheel of emotions
 * - Relationship tracking and dynamics
 */

// ============================================================================
// PERSONALITY TRAITS (BIG FIVE / OCEAN)
// ============================================================================

/** Personality trait ranges: -1 to 1 */
export const TRAIT = {
  OPENNESS: "openness",           // Creative/Curious vs Consistent/Cautious
  CONSCIENTIOUSNESS: "conscientiousness", // Efficient/Organized vs Spontaneous
  EXTRAVERSION: "extraversion",   // Outgoing/Energetic vs Solitary/Reserved
  AGREEABLENESS: "agreeableness", // Friendly/Compassionate vs Challenging/Detached
  NEUROTICISM: "neuroticism",     // Sensitive/Nervous vs Resilient/Confident
};

/**
 * Create personality profile
 * @param {Object} traits - Initial trait values (-1 to 1)
 * @returns {Object} Personality profile
 */
export function createPersonality(traits = {}) {
  return {
    [TRAIT.OPENNESS]: traits.openness ?? aiRng.range(-1, 1),
    [TRAIT.CONSCIENTIOUSNESS]: traits.conscientiousness ?? aiRng.range(-1, 1),
    [TRAIT.EXTRAVERSION]: traits.extraversion ?? aiRng.range(-1, 1),
    [TRAIT.AGREEABLENESS]: traits.agreeableness ?? aiRng.range(-1, 1),
    [TRAIT.NEUROTICISM]: traits.neuroticism ?? aiRng.range(-1, 1),
  };
}

/**
 * Create personality from archetype
 * @param {string} archetype - Archetype name
 * @returns {Object} Personality profile
 */
export function createPersonalityFromArchetype(archetype) {
  const archetypes = {
    hero: { openness: 0.5, conscientiousness: 0.7, extraversion: 0.6, agreeableness: 0.6, neuroticism: -0.3 },
    villain: { openness: 0.3, conscientiousness: 0.4, extraversion: 0.2, agreeableness: -0.8, neuroticism: 0.4 },
    mentor: { openness: 0.8, conscientiousness: 0.6, extraversion: 0.3, agreeableness: 0.7, neuroticism: -0.4 },
    trickster: { openness: 0.9, conscientiousness: -0.5, extraversion: 0.7, agreeableness: 0, neuroticism: 0.2 },
    guardian: { openness: -0.2, conscientiousness: 0.8, extraversion: 0.1, agreeableness: 0.5, neuroticism: 0.1 },
    rebel: { openness: 0.6, conscientiousness: -0.4, extraversion: 0.5, agreeableness: -0.3, neuroticism: 0.3 },
    innocent: { openness: 0.4, conscientiousness: 0.3, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.2 },
    sage: { openness: 0.9, conscientiousness: 0.5, extraversion: -0.3, agreeableness: 0.4, neuroticism: -0.5 },
    coward: { openness: -0.4, conscientiousness: 0.2, extraversion: -0.5, agreeableness: 0.3, neuroticism: 0.8 },
    soldier: { openness: -0.2, conscientiousness: 0.9, extraversion: 0.2, agreeableness: 0.1, neuroticism: -0.2 },
  };
  
  const base = archetypes[archetype] || archetypes.hero;
  return createPersonality(base);
}

/**
 * Get personality-based behavior modifier
 * @param {Object} personality - Personality profile
 * @param {string} behavior - Behavior type
 * @returns {number} Modifier (-1 to 1)
 */
export function getPersonalityBehaviorMod(personality, behavior) {
  const mods = {
    aggression: -personality[TRAIT.AGREEABLENESS] * 0.5 + personality[TRAIT.NEUROTICISM] * 0.3,
    caution: -personality[TRAIT.OPENNESS] * 0.3 + personality[TRAIT.NEUROTICISM] * 0.4,
    cooperation: personality[TRAIT.AGREEABLENESS] * 0.5 + personality[TRAIT.EXTRAVERSION] * 0.2,
    leadership: personality[TRAIT.EXTRAVERSION] * 0.4 + personality[TRAIT.CONSCIENTIOUSNESS] * 0.3,
    creativity: personality[TRAIT.OPENNESS] * 0.6 - personality[TRAIT.CONSCIENTIOUSNESS] * 0.2,
    discipline: personality[TRAIT.CONSCIENTIOUSNESS] * 0.5 - personality[TRAIT.OPENNESS] * 0.2,
    risk_taking: personality[TRAIT.OPENNESS] * 0.3 - personality[TRAIT.NEUROTICISM] * 0.4,
    social: personality[TRAIT.EXTRAVERSION] * 0.5 + personality[TRAIT.AGREEABLENESS] * 0.3,
    loyalty: personality[TRAIT.CONSCIENTIOUSNESS] * 0.3 + personality[TRAIT.AGREEABLENESS] * 0.3,
    mercy: personality[TRAIT.AGREEABLENESS] * 0.6 - personality[TRAIT.NEUROTICISM] * 0.2,
  };
  
  return mods[behavior] ?? 0;
}

// ============================================================================
// EMOTIONS (PLUTCHIK'S WHEEL)
// ============================================================================

/** Primary emotions */
export const EMOTION = {
  JOY: "joy",
  TRUST: "trust",
  FEAR: "fear",
  SURPRISE: "surprise",
  SADNESS: "sadness",
  DISGUST: "disgust",
  ANGER: "anger",
  ANTICIPATION: "anticipation",
};

/** Emotion combinations */
export const COMPLEX_EMOTION = {
  LOVE: { primary: [EMOTION.JOY, EMOTION.TRUST] },
  SUBMISSION: { primary: [EMOTION.TRUST, EMOTION.FEAR] },
  AWE: { primary: [EMOTION.FEAR, EMOTION.SURPRISE] },
  DISAPPROVAL: { primary: [EMOTION.SURPRISE, EMOTION.SADNESS] },
  REMORSE: { primary: [EMOTION.SADNESS, EMOTION.DISGUST] },
  CONTEMPT: { primary: [EMOTION.DISGUST, EMOTION.ANGER] },
  AGGRESSIVENESS: { primary: [EMOTION.ANGER, EMOTION.ANTICIPATION] },
  OPTIMISM: { primary: [EMOTION.ANTICIPATION, EMOTION.JOY] },
};

/**
 * Create emotional state
 * @returns {Object} Emotional state
 */
export function createEmotionalState() {
  return {
    // Primary emotions (0-1 intensity)
    [EMOTION.JOY]: 0,
    [EMOTION.TRUST]: 0,
    [EMOTION.FEAR]: 0,
    [EMOTION.SURPRISE]: 0,
    [EMOTION.SADNESS]: 0,
    [EMOTION.DISGUST]: 0,
    [EMOTION.ANGER]: 0,
    [EMOTION.ANTICIPATION]: 0,
    
    // Overall mood (-1 to 1)
    mood: 0,
    
    // Emotional stability
    volatility: 0.5, // How quickly emotions change
    
    // Dominant emotion tracking
    dominantEmotion: null,
    dominantIntensity: 0,
  };
}

/**
 * Apply emotional stimulus
 * @param {Object} state - Emotional state
 * @param {string} emotion - Emotion type
 * @param {number} intensity - Stimulus intensity (0-1)
 * @param {Object} personality - Personality (affects response)
 */
export function applyEmotionalStimulus(state, emotion, intensity, personality = null) {
  // Personality modifies emotional response
  let modifier = 1;
  if (personality) {
    if (emotion === EMOTION.FEAR || emotion === EMOTION.ANGER || emotion === EMOTION.SADNESS) {
      modifier += personality[TRAIT.NEUROTICISM] * 0.3;
    }
    if (emotion === EMOTION.JOY || emotion === EMOTION.TRUST) {
      modifier += personality[TRAIT.EXTRAVERSION] * 0.2;
    }
  }
  
  const adjustedIntensity = Math.min(1, intensity * modifier * state.volatility);
  state[emotion] = Math.min(1, state[emotion] + adjustedIntensity);
  
  updateDominantEmotion(state);
  updateMood(state);
}

/**
 * Decay emotions over time
 * @param {Object} state - Emotional state
 * @param {number} deltaTimeSec - Delta time in seconds
 * @param {number} decayRate - Base decay rate
 */
export function decayEmotions(state, deltaTimeSec, decayRate = 0.1) {
  const decay = decayRate * deltaTimeSec;
  
  for (const emotion of Object.values(EMOTION)) {
    state[emotion] = Math.max(0, state[emotion] - decay);
  }
  
  updateDominantEmotion(state);
  updateMood(state);
}

/**
 * Update dominant emotion
 * @param {Object} state - Emotional state
 */
function updateDominantEmotion(state) {
  let max = 0;
  let dominant = null;
  
  for (const emotion of Object.values(EMOTION)) {
    if (state[emotion] > max) {
      max = state[emotion];
      dominant = emotion;
    }
  }
  
  state.dominantEmotion = dominant;
  state.dominantIntensity = max;
}

/**
 * Update mood from emotions
 * @param {Object} state - Emotional state
 */
function updateMood(state) {
  // Positive emotions increase mood, negative decrease
  const positive = state[EMOTION.JOY] + state[EMOTION.TRUST] + state[EMOTION.ANTICIPATION];
  const negative = state[EMOTION.FEAR] + state[EMOTION.SADNESS] + state[EMOTION.ANGER] + state[EMOTION.DISGUST];
  
  state.mood = (positive - negative) / 4;
  state.mood = Math.max(-1, Math.min(1, state.mood));
}

/**
 * Check for complex emotion
 * @param {Object} state - Emotional state
 * @param {string} complexEmotion - Complex emotion name
 * @param {number} threshold - Detection threshold
 * @returns {boolean} Is emotion present
 */
export function hasComplexEmotion(state, complexEmotion, threshold = 0.3) {
  const def = COMPLEX_EMOTION[complexEmotion];
  if (!def) return false;
  
  const avg = statsMean(def.primary.map((emotion) => state[emotion]));
  return avg >= threshold;
}

// ============================================================================
// RELATIONSHIPS
// ============================================================================

/** Relationship types */
export const RELATIONSHIP_TYPE = {
  STRANGER: "stranger",
  ACQUAINTANCE: "acquaintance",
  FRIEND: "friend",
  CLOSE_FRIEND: "close_friend",
  RIVAL: "rival",
  ENEMY: "enemy",
  ALLY: "ally",
  MENTOR: "mentor",
  STUDENT: "student",
  ROMANTIC: "romantic",
  FAMILY: "family",
};

/**
 * Create relationship tracker
 * @returns {Object} Relationship tracker
 */
export function createRelationshipTracker() {
  return {
    relationships: new Map(), // entityId → relationship data
  };
}

/**
 * Create or get relationship with entity
 * @param {Object} tracker - Relationship tracker
 * @param {number} entityId - Other entity ID
 * @returns {Object} Relationship data
 */
export function getRelationship(tracker, entityId) {
  if (!tracker.relationships.has(entityId)) {
    tracker.relationships.set(entityId, {
      entityId,
      type: RELATIONSHIP_TYPE.STRANGER,
      
      // Core dimensions (-1 to 1)
      trust: 0,
      respect: 0,
      affection: 0,
      familiarity: 0,
      
      // Interaction tracking
      interactionCount: 0,
      positiveInteractions: 0,
      negativeInteractions: 0,
      lastInteraction: 0,
      
      // History
      significantEvents: [],
    });
  }
  
  return tracker.relationships.get(entityId);
}

/**
 * Record interaction with entity
 * @param {Object} tracker - Relationship tracker
 * @param {number} entityId - Other entity ID
 * @param {string} interactionType - Type of interaction
 * @param {number} valence - Positive/negative (-1 to 1)
 * @param {number} intensity - Interaction intensity (0-1)
 */
export function recordInteraction(tracker, entityId, interactionType, valence, intensity = 0.5) {
  const rel = getRelationship(tracker, entityId);
  
  rel.interactionCount++;
  rel.lastInteraction = performance.now();
  
  if (valence > 0) {
    rel.positiveInteractions++;
  } else if (valence < 0) {
    rel.negativeInteractions++;
  }
  
  // Update dimensions
  const change = valence * intensity * 0.1;
  
  switch (interactionType) {
    case "helped":
    case "saved":
    case "gifted":
      rel.trust = Math.max(-1, Math.min(1, rel.trust + change * 1.5));
      rel.affection = Math.max(-1, Math.min(1, rel.affection + change));
      break;
      
    case "betrayed":
    case "attacked":
    case "insulted":
      rel.trust = Math.max(-1, Math.min(1, rel.trust + change * 2));
      rel.respect = Math.max(-1, Math.min(1, rel.respect + change * 0.5));
      break;
      
    case "impressed":
    case "taught":
      rel.respect = Math.max(-1, Math.min(1, rel.respect + change * 1.5));
      break;
      
    case "talked":
    case "worked_together":
      rel.familiarity = Math.min(1, rel.familiarity + 0.05);
      rel.affection = Math.max(-1, Math.min(1, rel.affection + change * 0.3));
      break;
  }
  
  // Update relationship type
  updateRelationshipType(rel);
  
  // Store significant events
  if (Math.abs(valence) > 0.5) {
    rel.significantEvents.push({
      type: interactionType,
      valence,
      timestamp: performance.now(),
    });
    
    // Limit history
    if (rel.significantEvents.length > 20) {
      rel.significantEvents.shift();
    }
  }
}

/**
 * Update relationship type based on dimensions
 * @param {Object} rel - Relationship data
 */
function updateRelationshipType(rel) {
  const { trust, respect, affection, familiarity } = rel;
  const overall = (trust + respect + affection) / 3;
  
  if (familiarity < 0.1) {
    rel.type = RELATIONSHIP_TYPE.STRANGER;
  } else if (overall < -0.5) {
    rel.type = RELATIONSHIP_TYPE.ENEMY;
  } else if (overall < -0.2) {
    rel.type = RELATIONSHIP_TYPE.RIVAL;
  } else if (familiarity < 0.3) {
    rel.type = RELATIONSHIP_TYPE.ACQUAINTANCE;
  } else if (overall > 0.6 && affection > 0.5) {
    rel.type = RELATIONSHIP_TYPE.CLOSE_FRIEND;
  } else if (overall > 0.3) {
    rel.type = RELATIONSHIP_TYPE.FRIEND;
  } else if (trust > 0.5 && respect > 0.3) {
    rel.type = RELATIONSHIP_TYPE.ALLY;
  } else {
    rel.type = RELATIONSHIP_TYPE.ACQUAINTANCE;
  }
}

/**
 * Get disposition toward entity
 * @param {Object} tracker - Relationship tracker
 * @param {number} entityId - Other entity ID
 * @returns {number} Disposition (-1 to 1)
 */
export function getDisposition(tracker, entityId) {
  const rel = getRelationship(tracker, entityId);
  return (rel.trust + rel.respect + rel.affection) / 3;
}

/**
 * Will entity help another
 * @param {Object} tracker - Relationship tracker
 * @param {number} entityId - Other entity ID
 * @param {Object} personality - Helper's personality
 * @returns {boolean} Will help
 */
export function willHelp(tracker, entityId, personality = null) {
  const disposition = getDisposition(tracker, entityId);
  let threshold = 0;
  
  if (personality) {
    threshold -= personality[TRAIT.AGREEABLENESS] * 0.3;
  }
  
  return disposition > threshold;
}

// ============================================================================
// COMPLETE CHARACTER STATE
// ============================================================================

/**
 * Create complete character psychological state
 * @param {Object} config - Configuration
 * @returns {Object} Character state
 */
export function createCharacterState(config = {}) {
  return {
    personality: config.archetype 
      ? createPersonalityFromArchetype(config.archetype)
      : createPersonality(config.personality),
    emotions: createEmotionalState(),
    relationships: createRelationshipTracker(),
    
    // Goals and motivations
    goals: config.goals || [],
    values: config.values || [], // What they care about
    fears: config.fears || [],
  };
}

/**
 * Update character state
 * @param {Object} state - Character state
 * @param {number} deltaTimeSec - Delta time
 */
export function updateCharacterState(state, deltaTimeSec) {
  decayEmotions(state.emotions, deltaTimeSec);
}
