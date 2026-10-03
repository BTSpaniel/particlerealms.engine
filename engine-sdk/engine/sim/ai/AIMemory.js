// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIMemory.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIMemory.js (original) - Advanced Memory System
 * 
 * Multi-layered memory inspired by cognitive science:
 * - Working Memory (short-term, limited capacity)
 * - Episodic Memory (personal experiences)
 * - Semantic Memory (facts and knowledge)
 * - Procedural Memory (learned skills)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Memory types */
export const MEMORY_TYPE = {
  WORKING: "working",     // Temporary, current focus
  EPISODIC: "episodic",   // Personal experiences
  SEMANTIC: "semantic",   // Facts and knowledge
  PROCEDURAL: "procedural", // Skills and habits
};

/** Event importance levels */
export const IMPORTANCE = {
  TRIVIAL: 1,
  MINOR: 2,
  NORMAL: 3,
  SIGNIFICANT: 4,
  CRITICAL: 5,
};

// ============================================================================
// WORKING MEMORY
// ============================================================================

/**
 * Create working memory (limited capacity short-term)
 * @param {number} capacity - Max items (default 7, like humans)
 * @returns {Object} Working memory
 */
export function createWorkingMemory(capacity = 7) {
  return {
    type: MEMORY_TYPE.WORKING,
    capacity,
    items: [],
    focus: null, // Current primary focus
  };
}

/**
 * Add item to working memory (displaces oldest if full)
 * @param {Object} memory - Working memory
 * @param {Object} item - {type, data, priority}
 */
export function workingMemoryPush(memory, item) {
  const entry = {
    ...item,
    timestamp: performance.now(),
  };
  
  // Remove lowest priority if at capacity
  if (memory.items.length >= memory.capacity) {
    let lowestIdx = 0;
    let lowestPriority = memory.items[0].priority || 0;
    
    for (let i = 1; i < memory.items.length; i++) {
      if ((memory.items[i].priority || 0) < lowestPriority) {
        lowestPriority = memory.items[i].priority || 0;
        lowestIdx = i;
      }
    }
    
    // Only displace if new item is higher priority
    if ((item.priority || 0) >= lowestPriority) {
      memory.items.splice(lowestIdx, 1);
    } else {
      return; // Don't add lower priority item
    }
  }
  
  memory.items.push(entry);
}

/**
 * Set focus of attention
 * @param {Object} memory - Working memory
 * @param {string} type - Focus type
 * @param {*} data - Focus data
 */
export function setFocus(memory, type, data) {
  memory.focus = { type, data, timestamp: performance.now() };
}

/**
 * Get items from working memory by type
 * @param {Object} memory - Working memory
 * @param {string} type - Item type
 * @returns {Array} Matching items
 */
export function getWorkingMemoryByType(memory, type) {
  return memory.items.filter(item => item.type === type);
}

/**
 * Clear working memory
 * @param {Object} memory - Working memory
 */
export function clearWorkingMemory(memory) {
  memory.items = [];
  memory.focus = null;
}

// ============================================================================
// EPISODIC MEMORY
// ============================================================================

/**
 * Create episodic memory (personal experiences)
 * @param {number} maxEpisodes - Maximum stored episodes
 * @returns {Object} Episodic memory
 */
export function createEpisodicMemory(maxEpisodes = 1000) {
  return {
    type: MEMORY_TYPE.EPISODIC,
    episodes: [],
    maxEpisodes,
    emotionalIndex: new Map(), // emotion → episode indices
    entityIndex: new Map(),    // entity → episode indices
    locationIndex: new Map(),  // location → episode indices
  };
}

/**
 * Create an episode (memory of an event)
 * @param {Object} data - Episode data
 * @returns {Object} Episode
 */
export function createEpisode(data) {
  return {
    id: data.id || aiRng.uniqueId('ep'),
    timestamp: data.timestamp || performance.now(),
    gameTime: data.gameTime || 0,
    
    // What happened
    eventType: data.eventType,
    description: data.description || "",
    
    // Context
    location: data.location ? [...data.location] : null,
    locationName: data.locationName || null,
    
    // Participants
    entities: data.entities || [], // [{id, role, name}]
    selfRole: data.selfRole || "observer",
    
    // Emotional valence
    emotion: data.emotion || "neutral", // happy, sad, angry, scared, etc.
    emotionalIntensity: data.emotionalIntensity ?? 0.5, // 0-1
    
    // Importance affects retention
    importance: data.importance ?? IMPORTANCE.NORMAL,
    
    // Outcome
    outcome: data.outcome || null, // positive, negative, neutral
    
    // Related memories
    relatedEpisodes: data.relatedEpisodes || [],
    
    // Recall tracking
    recallCount: 0,
    lastRecall: 0,
  };
}

/**
 * Store an episode
 * @param {Object} memory - Episodic memory
 * @param {Object} episode - Episode to store
 */
export function storeEpisode(memory, episode) {
  // Check capacity
  if (memory.episodes.length >= memory.maxEpisodes) {
    // Remove least important/oldest episode
    forgetLeastImportantEpisode(memory);
  }
  
  const idx = memory.episodes.length;
  memory.episodes.push(episode);
  
  // Index by emotion
  if (episode.emotion) {
    if (!memory.emotionalIndex.has(episode.emotion)) {
      memory.emotionalIndex.set(episode.emotion, []);
    }
    memory.emotionalIndex.get(episode.emotion).push(idx);
  }
  
  // Index by entities
  for (const entity of episode.entities) {
    if (!memory.entityIndex.has(entity.id)) {
      memory.entityIndex.set(entity.id, []);
    }
    memory.entityIndex.get(entity.id).push(idx);
  }
  
  // Index by location
  if (episode.locationName) {
    if (!memory.locationIndex.has(episode.locationName)) {
      memory.locationIndex.set(episode.locationName, []);
    }
    memory.locationIndex.get(episode.locationName).push(idx);
  }
}

/**
 * Recall episodes involving an entity
 * @param {Object} memory - Episodic memory
 * @param {number} entityId - Entity ID
 * @param {number} limit - Max episodes to return
 * @returns {Array<Object>} Episodes
 */
export function recallEpisodesWithEntity(memory, entityId, limit = 10) {
  const indices = memory.entityIndex.get(entityId) || [];
  const episodes = [];
  
  for (let i = indices.length - 1; i >= 0 && episodes.length < limit; i--) {
    const ep = memory.episodes[indices[i]];
    if (ep) {
      ep.recallCount++;
      ep.lastRecall = performance.now();
      episodes.push(ep);
    }
  }
  
  return episodes;
}

/**
 * Recall episodes by emotion
 * @param {Object} memory - Episodic memory
 * @param {string} emotion - Emotion type
 * @param {number} limit - Max episodes
 * @returns {Array<Object>} Episodes
 */
export function recallEpisodesWithEmotion(memory, emotion, limit = 10) {
  const indices = memory.emotionalIndex.get(emotion) || [];
  const episodes = [];
  
  for (let i = indices.length - 1; i >= 0 && episodes.length < limit; i--) {
    const ep = memory.episodes[indices[i]];
    if (ep) {
      ep.recallCount++;
      ep.lastRecall = performance.now();
      episodes.push(ep);
    }
  }
  
  return episodes;
}

/**
 * Recall recent episodes
 * @param {Object} memory - Episodic memory
 * @param {number} count - Number to recall
 * @returns {Array<Object>} Recent episodes
 */
export function recallRecentEpisodes(memory, count = 5) {
  const start = Math.max(0, memory.episodes.length - count);
  return memory.episodes.slice(start).reverse();
}

/**
 * Search episodes by criteria
 * @param {Object} memory - Episodic memory
 * @param {Object} criteria - Search criteria
 * @returns {Array<Object>} Matching episodes
 */
export function searchEpisodes(memory, criteria) {
  return memory.episodes.filter(ep => {
    if (criteria.eventType && ep.eventType !== criteria.eventType) return false;
    if (criteria.minImportance && ep.importance < criteria.minImportance) return false;
    if (criteria.emotion && ep.emotion !== criteria.emotion) return false;
    if (criteria.outcome && ep.outcome !== criteria.outcome) return false;
    if (criteria.locationName && ep.locationName !== criteria.locationName) return false;
    if (criteria.afterTime && ep.timestamp < criteria.afterTime) return false;
    if (criteria.beforeTime && ep.timestamp > criteria.beforeTime) return false;
    return true;
  });
}

/**
 * Forget least important episode
 * @param {Object} memory - Episodic memory
 */
function forgetLeastImportantEpisode(memory) {
  if (memory.episodes.length === 0) return;
  
  let lowestIdx = 0;
  let lowestScore = Infinity;
  const now = performance.now();
  
  for (let i = 0; i < memory.episodes.length; i++) {
    const ep = memory.episodes[i];
    // Score based on importance, recency, and recall frequency
    const age = (now - ep.timestamp) / (1000 * 60 * 60); // hours
    const score = ep.importance + ep.recallCount * 0.5 - age * 0.1;
    
    if (score < lowestScore) {
      lowestScore = score;
      lowestIdx = i;
    }
  }
  
  memory.episodes.splice(lowestIdx, 1);
  // Note: indices in other maps become invalid, should rebuild periodically
}

// ============================================================================
// SEMANTIC MEMORY
// ============================================================================

/**
 * Create semantic memory (facts and knowledge)
 * @returns {Object} Semantic memory
 */
export function createSemanticMemory() {
  return {
    type: MEMORY_TYPE.SEMANTIC,
    facts: new Map(),        // key → {value, confidence, source, timestamp}
    categories: new Map(),   // category → Set of entity IDs
    relationships: [],       // [{subject, predicate, object, confidence}]
    beliefs: new Map(),      // topic → {belief, confidence}
  };
}

/**
 * Store a fact
 * @param {Object} memory - Semantic memory
 * @param {string} key - Fact key
 * @param {*} value - Fact value
 * @param {Object} meta - Metadata {confidence, source}
 */
export function storeFact(memory, key, value, meta = {}) {
  memory.facts.set(key, {
    value,
    confidence: meta.confidence ?? 1.0,
    source: meta.source || "observation",
    timestamp: performance.now(),
    accessCount: 0,
  });
}

/**
 * Retrieve a fact
 * @param {Object} memory - Semantic memory
 * @param {string} key - Fact key
 * @returns {{value: *, confidence: number}|null} Fact or null
 */
export function getFact(memory, key) {
  const fact = memory.facts.get(key);
  if (!fact) return null;
  
  fact.accessCount++;
  return { value: fact.value, confidence: fact.confidence };
}

/**
 * Store a relationship between entities
 * @param {Object} memory - Semantic memory
 * @param {number} subject - Subject entity ID
 * @param {string} predicate - Relationship type
 * @param {number} object - Object entity ID
 * @param {number} confidence - Confidence 0-1
 */
export function storeRelationship(memory, subject, predicate, object, confidence = 1.0) {
  // Check if relationship exists
  const existing = memory.relationships.find(
    r => r.subject === subject && r.predicate === predicate && r.object === object
  );
  
  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.timestamp = performance.now();
  } else {
    memory.relationships.push({
      subject,
      predicate,
      object,
      confidence,
      timestamp: performance.now(),
    });
  }
}

/**
 * Query relationships
 * @param {Object} memory - Semantic memory
 * @param {Object} query - {subject?, predicate?, object?}
 * @returns {Array} Matching relationships
 */
export function queryRelationships(memory, query) {
  return memory.relationships.filter(r => {
    if (query.subject !== undefined && r.subject !== query.subject) return false;
    if (query.predicate !== undefined && r.predicate !== query.predicate) return false;
    if (query.object !== undefined && r.object !== query.object) return false;
    return true;
  });
}

/**
 * Store a belief
 * @param {Object} memory - Semantic memory
 * @param {string} topic - Belief topic
 * @param {string} belief - The belief
 * @param {number} confidence - How strongly held
 */
export function storeBelief(memory, topic, belief, confidence = 0.5) {
  memory.beliefs.set(topic, {
    belief,
    confidence,
    formed: performance.now(),
    challenges: 0,
  });
}

/**
 * Challenge a belief (potentially weakens it)
 * @param {Object} memory - Semantic memory
 * @param {string} topic - Belief topic
 * @param {number} evidenceStrength - Strength of contradicting evidence
 */
export function challengeBelief(memory, topic, evidenceStrength = 0.1) {
  const belief = memory.beliefs.get(topic);
  if (!belief) return;
  
  belief.challenges++;
  belief.confidence = Math.max(0, belief.confidence - evidenceStrength);
  
  // Remove belief if confidence drops too low
  if (belief.confidence < 0.1) {
    memory.beliefs.delete(topic);
  }
}

// ============================================================================
// PROCEDURAL MEMORY
// ============================================================================

/**
 * Create procedural memory (skills and habits)
 * @returns {Object} Procedural memory
 */
export function createProceduralMemory() {
  return {
    type: MEMORY_TYPE.PROCEDURAL,
    skills: new Map(),   // skill → {proficiency, practice, lastUsed}
    habits: [],          // [{trigger, action, strength}]
    patterns: new Map(), // situation → preferred action
  };
}

/**
 * Record skill practice
 * @param {Object} memory - Procedural memory
 * @param {string} skill - Skill name
 * @param {boolean} success - Was the attempt successful
 */
export function practiceSkill(memory, skill, success = true) {
  let skillData = memory.skills.get(skill);
  
  if (!skillData) {
    skillData = {
      proficiency: 0,
      practice: 0,
      successes: 0,
      lastUsed: 0,
    };
    memory.skills.set(skill, skillData);
  }
  
  skillData.practice++;
  if (success) skillData.successes++;
  skillData.lastUsed = performance.now();
  
  // Proficiency increases with practice (diminishing returns)
  const successRate = skillData.successes / skillData.practice;
  skillData.proficiency = Math.min(1, 
    skillData.proficiency + (1 - skillData.proficiency) * 0.1 * (success ? 1 : 0.5)
  );
}

/**
 * Get skill proficiency
 * @param {Object} memory - Procedural memory
 * @param {string} skill - Skill name
 * @returns {number} Proficiency 0-1
 */
export function getSkillProficiency(memory, skill) {
  const data = memory.skills.get(skill);
  return data ? data.proficiency : 0;
}

/**
 * Form a habit
 * @param {Object} memory - Procedural memory
 * @param {string} trigger - What triggers the habit
 * @param {string} action - The habitual action
 * @param {number} initialStrength - Starting strength
 */
export function formHabit(memory, trigger, action, initialStrength = 0.3) {
  const existing = memory.habits.find(h => h.trigger === trigger && h.action === action);
  
  if (existing) {
    existing.strength = Math.min(1, existing.strength + 0.1);
    existing.executions++;
  } else {
    memory.habits.push({
      trigger,
      action,
      strength: initialStrength,
      formed: performance.now(),
      executions: 1,
    });
  }
}

/**
 * Get habitual response to trigger
 * @param {Object} memory - Procedural memory
 * @param {string} trigger - Trigger situation
 * @returns {string|null} Habitual action or null
 */
export function getHabitualResponse(memory, trigger) {
  const matching = memory.habits
    .filter(h => h.trigger === trigger && h.strength > 0.3)
    .sort((a, b) => b.strength - a.strength);
  
  return matching.length > 0 ? matching[0].action : null;
}

// ============================================================================
// COMPLETE MEMORY SYSTEM
// ============================================================================

/**
 * Create complete NPC memory system
 * @param {Object} config - Configuration
 * @returns {Object} Complete memory system
 */
export function createMemorySystem(config = {}) {
  return {
    working: createWorkingMemory(config.workingCapacity),
    episodic: createEpisodicMemory(config.maxEpisodes),
    semantic: createSemanticMemory(),
    procedural: createProceduralMemory(),
    
    // Cross-memory utilities
    lastConsolidation: 0,
    consolidationInterval: config.consolidationInterval ?? 60000, // 1 minute
  };
}

/**
 * Consolidate memories (transfer from working to long-term)
 * @param {Object} memSystem - Memory system
 */
export function consolidateMemories(memSystem) {
  const now = performance.now();
  
  // Move important working memory to episodic
  for (const item of memSystem.working.items) {
    if ((item.priority || 0) >= IMPORTANCE.SIGNIFICANT) {
      const episode = createEpisode({
        eventType: item.type,
        description: item.description || "",
        importance: item.priority,
        entities: item.entities || [],
        location: item.location,
      });
      storeEpisode(memSystem.episodic, episode);
    }
  }
  
  memSystem.lastConsolidation = now;
}

/**
 * Get overall impression of an entity
 * @param {Object} memSystem - Memory system
 * @param {number} entityId - Entity ID
 * @returns {Object} Impression {sentiment, familiarity, memories}
 */
export function getEntityImpression(memSystem, entityId) {
  const episodes = recallEpisodesWithEntity(memSystem.episodic, entityId, 20);
  const relationships = queryRelationships(memSystem.semantic, { subject: entityId });
  relationships.push(...queryRelationships(memSystem.semantic, { object: entityId }));
  
  // Calculate sentiment from episodes
  let sentiment = 0;
  for (const ep of episodes) {
    const valence = ep.outcome === "positive" ? 1 : ep.outcome === "negative" ? -1 : 0;
    sentiment += valence * ep.emotionalIntensity;
  }
  sentiment = episodes.length > 0 ? sentiment / episodes.length : 0;
  
  return {
    sentiment: Math.max(-1, Math.min(1, sentiment)),
    familiarity: Math.min(1, episodes.length / 10),
    episodeCount: episodes.length,
    relationships,
  };
}
