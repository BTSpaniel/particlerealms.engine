// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIKnowledge.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIKnowledge.js (original) - Knowledge Propagation and Rumors
 * 
 * Features:
 * - Information spreading between NPCs
 * - Rumor system with distortion
 * - Shared world knowledge
 * - Investigation and discovery
 * - Information value/age decay
 */

// ============================================================================
// KNOWLEDGE TYPES
// ============================================================================

/** Information types */
export const INFO_TYPE = {
  LOCATION: "location",     // Where something is
  EVENT: "event",           // Something that happened
  PERSON: "person",         // Info about someone
  ITEM: "item",             // Info about an item
  SECRET: "secret",         // Hidden information
  RUMOR: "rumor",           // Unverified info
  QUEST: "quest",           // Quest-related
  DANGER: "danger",         // Threat information
};

/** Information reliability */
export const RELIABILITY = {
  WITNESSED: 1.0,           // Saw it personally
  HEARD_FIRSTHAND: 0.8,     // Told by witness
  HEARD_SECONDHAND: 0.6,    // Told by someone who heard
  RUMOR: 0.4,               // General rumor
  SPECULATION: 0.2,         // Guess/theory
};

// ============================================================================
// KNOWLEDGE ITEM
// ============================================================================

/**
 * Create knowledge item
 * @param {Object} config - Knowledge config
 * @returns {Object} Knowledge item
 */
export function createKnowledge(config) {
  return {
    id: config.id || aiRng.uniqueId('knowledge'),
    type: config.type || INFO_TYPE.EVENT,
    
    // Content
    subject: config.subject,           // What/who is this about
    content: config.content,           // The actual information
    tags: config.tags || [],
    
    // Location relevance
    location: config.location || null, // Where this info is relevant
    locationRadius: config.locationRadius || 100,
    
    // Reliability
    reliability: config.reliability ?? RELIABILITY.WITNESSED,
    source: config.source || null,     // Who provided this info
    originalSource: config.originalSource || null,
    
    // Timing
    createdAt: config.createdAt || performance.now(),
    eventTime: config.eventTime || null, // When the event occurred
    expiresAt: config.expiresAt || null, // When info becomes stale
    
    // Propagation tracking
    spreadCount: 0,
    distortionLevel: 0,  // How much info has changed
    
    // Value
    importance: config.importance ?? 0.5, // 0-1
    secretLevel: config.secretLevel ?? 0, // 0 = public, higher = more secret
  };
}

/**
 * Create a distorted copy (for rumor spreading)
 * @param {Object} knowledge - Original knowledge
 * @param {number} distortion - Distortion amount
 * @returns {Object} Distorted copy
 */
export function distortKnowledge(knowledge, distortion = 0.1) {
  const copy = { ...knowledge };
  copy.id = aiRng.uniqueId('knowledge');
  
  // Decrease reliability
  copy.reliability = Math.max(0.1, copy.reliability - distortion);
  copy.distortionLevel += distortion;
  copy.spreadCount++;
  
  // Potentially change details if highly distorted
  if (copy.distortionLevel > 0.5 && copy.location) {
    // Location becomes less accurate
    copy.locationRadius *= 1.5;
  }
  
  return copy;
}

// ============================================================================
// NPC KNOWLEDGE BASE
// ============================================================================

/**
 * Create NPC knowledge base
 * @returns {Object} Knowledge base
 */
export function createKnowledgeBase() {
  return {
    knowledge: new Map(),          // id → knowledge
    bySubject: new Map(),          // subject → Set of knowledge ids
    byType: new Map(),             // type → Set of knowledge ids
    byTag: new Map(),              // tag → Set of knowledge ids
    
    // Social network
    trustedSources: new Set(),     // NPC IDs this NPC trusts
    distrustedSources: new Set(),  // NPC IDs this NPC distrusts
    
    // Interests
    interests: [],                 // Topics this NPC cares about
    
    // Configuration
    maxKnowledge: 200,
    forgetThreshold: 0.1,          // Reliability below this gets forgotten
  };
}

/**
 * Add knowledge to NPC's knowledge base
 * @param {Object} kb - Knowledge base
 * @param {Object} knowledge - Knowledge to add
 * @returns {boolean} Whether knowledge was new/updated
 */
export function addKnowledge(kb, knowledge) {
  const existing = kb.knowledge.get(knowledge.id);
  
  if (existing) {
    // Update if new info is more reliable
    if (knowledge.reliability > existing.reliability) {
      kb.knowledge.set(knowledge.id, knowledge);
      return true;
    }
    return false;
  }
  
  // Check capacity
  if (kb.knowledge.size >= kb.maxKnowledge) {
    forgetLeastImportant(kb);
  }
  
  // Add to knowledge base
  kb.knowledge.set(knowledge.id, knowledge);
  
  // Index by subject
  if (knowledge.subject) {
    if (!kb.bySubject.has(knowledge.subject)) {
      kb.bySubject.set(knowledge.subject, new Set());
    }
    kb.bySubject.get(knowledge.subject).add(knowledge.id);
  }
  
  // Index by type
  if (!kb.byType.has(knowledge.type)) {
    kb.byType.set(knowledge.type, new Set());
  }
  kb.byType.get(knowledge.type).add(knowledge.id);
  
  // Index by tags
  for (const tag of knowledge.tags) {
    if (!kb.byTag.has(tag)) {
      kb.byTag.set(tag, new Set());
    }
    kb.byTag.get(tag).add(knowledge.id);
  }
  
  return true;
}

/**
 * Query knowledge base
 * @param {Object} kb - Knowledge base
 * @param {Object} query - {subject?, type?, tag?, minReliability?}
 * @returns {Array<Object>} Matching knowledge
 */
export function queryKnowledge(kb, query) {
  let candidates = new Set(kb.knowledge.keys());
  
  // Filter by subject
  if (query.subject) {
    const subjectMatches = kb.bySubject.get(query.subject);
    if (subjectMatches) {
      candidates = new Set([...candidates].filter(id => subjectMatches.has(id)));
    } else {
      return [];
    }
  }
  
  // Filter by type
  if (query.type) {
    const typeMatches = kb.byType.get(query.type);
    if (typeMatches) {
      candidates = new Set([...candidates].filter(id => typeMatches.has(id)));
    } else {
      return [];
    }
  }
  
  // Filter by tag
  if (query.tag) {
    const tagMatches = kb.byTag.get(query.tag);
    if (tagMatches) {
      candidates = new Set([...candidates].filter(id => tagMatches.has(id)));
    } else {
      return [];
    }
  }
  
  // Get full knowledge items
  const results = [];
  for (const id of candidates) {
    const k = kb.knowledge.get(id);
    if (k && (!query.minReliability || k.reliability >= query.minReliability)) {
      results.push(k);
    }
  }
  
  // Sort by reliability then importance
  results.sort((a, b) => {
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    return b.importance - a.importance;
  });
  
  return results;
}

/**
 * Check if NPC knows about something
 * @param {Object} kb - Knowledge base
 * @param {string} subject - Subject to check
 * @returns {boolean} Has knowledge
 */
export function hasKnowledgeOf(kb, subject) {
  return kb.bySubject.has(subject) && kb.bySubject.get(subject).size > 0;
}

/**
 * Forget least important knowledge
 */
function forgetLeastImportant(kb) {
  let leastImportant = null;
  let lowestScore = Infinity;
  
  for (const [id, k] of kb.knowledge) {
    const score = k.importance * k.reliability;
    if (score < lowestScore) {
      lowestScore = score;
      leastImportant = id;
    }
  }
  
  if (leastImportant) {
    removeKnowledge(kb, leastImportant);
  }
}

/**
 * Remove knowledge from base
 */
function removeKnowledge(kb, knowledgeId) {
  const k = kb.knowledge.get(knowledgeId);
  if (!k) return;
  
  kb.knowledge.delete(knowledgeId);
  
  if (k.subject) {
    kb.bySubject.get(k.subject)?.delete(knowledgeId);
  }
  kb.byType.get(k.type)?.delete(knowledgeId);
  for (const tag of k.tags) {
    kb.byTag.get(tag)?.delete(knowledgeId);
  }
}

// ============================================================================
// KNOWLEDGE SHARING
// ============================================================================

/**
 * Share knowledge between NPCs
 * @param {Object} giver - Giver's knowledge base
 * @param {Object} receiver - Receiver's knowledge base
 * @param {Object} knowledge - Knowledge to share
 * @param {Object} giverNpcId - Giver's NPC ID
 * @returns {{accepted: boolean, knowledge: Object|null}}
 */
export function shareKnowledge(giver, receiver, knowledge, giverNpcId) {
  // Check if receiver trusts giver
  const trustModifier = receiver.trustedSources.has(giverNpcId) ? 1.2 :
                        receiver.distrustedSources.has(giverNpcId) ? 0.5 : 1.0;
  
  // Create potentially distorted copy
  const shared = distortKnowledge(knowledge, 0.05);
  shared.source = giverNpcId;
  shared.reliability *= trustModifier;
  
  // Check if receiver cares about this topic
  const isInteresting = receiver.interests.length === 0 || 
    receiver.interests.some(i => 
      knowledge.tags.includes(i) || 
      knowledge.subject === i ||
      knowledge.type === i
    );
  
  if (!isInteresting && !aiRng.chance(0.3)) {
    return { accepted: false, knowledge: null };
  }
  
  // Add to receiver's knowledge
  const accepted = addKnowledge(receiver, shared);
  
  return { accepted, knowledge: accepted ? shared : null };
}

/**
 * Spread knowledge through social network
 * @param {Object} network - Social network manager
 * @param {Object} knowledge - Knowledge to spread
 * @param {string} originNpcId - Origin NPC ID
 * @param {number} maxHops - Maximum spread distance
 */
export function spreadKnowledge(network, knowledge, originNpcId, maxHops = 3) {
  const visited = new Set([originNpcId]);
  const queue = [{ npcId: originNpcId, hops: 0 }];
  
  while (queue.length > 0) {
    const { npcId, hops } = queue.shift();
    if (hops >= maxHops) continue;
    
    const connections = network.getConnections(npcId);
    
    for (const connectedId of connections) {
      if (visited.has(connectedId)) continue;
      visited.add(connectedId);
      
      const receiverKb = network.getKnowledgeBase(connectedId);
      if (!receiverKb) continue;
      
      // Chance to share decreases with hops
      const shareChance = 0.7 - hops * 0.2;
      if (!aiRng.chance(shareChance)) continue;
      
      // Share with increasing distortion
      const distortion = 0.1 + hops * 0.1;
      const distorted = distortKnowledge(knowledge, distortion);
      distorted.source = npcId;
      
      if (addKnowledge(receiverKb, distorted)) {
        queue.push({ npcId: connectedId, hops: hops + 1 });
      }
    }
  }
}

// ============================================================================
// WORLD KNOWLEDGE MANAGER
// ============================================================================

/**
 * Create world knowledge manager
 * @returns {Object} Knowledge manager
 */
export function createWorldKnowledgeManager() {
  return {
    // Global public knowledge
    publicKnowledge: new Map(),
    
    // NPC knowledge bases
    npcKnowledge: new Map(), // npcId → knowledge base
    
    // Social network (who knows who)
    socialNetwork: new Map(), // npcId → Set of connected npcIds
    
    // Pending knowledge propagations
    pendingSpread: [],
    
    // Configuration
    spreadInterval: 3600, // Game seconds between spread cycles
    lastSpreadTime: 0,
  };
}

/**
 * Register NPC with knowledge system
 * @param {Object} manager - Knowledge manager
 * @param {string} npcId - NPC ID
 * @param {Object} config - {interests, trustedSources}
 */
export function registerNPCKnowledge(manager, npcId, config = {}) {
  const kb = createKnowledgeBase();
  kb.interests = config.interests || [];
  
  for (const trusted of (config.trustedSources || [])) {
    kb.trustedSources.add(trusted);
  }
  
  manager.npcKnowledge.set(npcId, kb);
  
  if (!manager.socialNetwork.has(npcId)) {
    manager.socialNetwork.set(npcId, new Set());
  }
}

/**
 * Connect two NPCs in social network
 * @param {Object} manager - Knowledge manager
 * @param {string} npc1 - First NPC ID
 * @param {string} npc2 - Second NPC ID
 */
export function connectNPCs(manager, npc1, npc2) {
  if (!manager.socialNetwork.has(npc1)) {
    manager.socialNetwork.set(npc1, new Set());
  }
  if (!manager.socialNetwork.has(npc2)) {
    manager.socialNetwork.set(npc2, new Set());
  }
  
  manager.socialNetwork.get(npc1).add(npc2);
  manager.socialNetwork.get(npc2).add(npc1);
}

/**
 * Announce public knowledge
 * @param {Object} manager - Knowledge manager
 * @param {Object} knowledge - Knowledge to announce
 */
export function announcePublicKnowledge(manager, knowledge) {
  manager.publicKnowledge.set(knowledge.id, knowledge);
  
  // Queue for spreading to all NPCs
  manager.pendingSpread.push({
    knowledge,
    targetAll: true,
  });
}

/**
 * Update knowledge propagation
 * @param {Object} manager - Knowledge manager
 * @param {number} gameTime - Current game time
 */
export function updateKnowledgePropagation(manager, gameTime) {
  if (gameTime - manager.lastSpreadTime < manager.spreadInterval) {
    return;
  }
  
  manager.lastSpreadTime = gameTime;
  
  // Process pending spreads
  while (manager.pendingSpread.length > 0) {
    const spread = manager.pendingSpread.shift();
    
    if (spread.targetAll) {
      // Spread to all NPCs
      for (const [npcId, kb] of manager.npcKnowledge) {
        const distorted = distortKnowledge(spread.knowledge, 0.05);
        addKnowledge(kb, distorted);
      }
    } else if (spread.npcId) {
      // Spread from specific NPC
      const connections = manager.socialNetwork.get(spread.npcId);
      if (connections) {
        for (const connectedId of connections) {
          const kb = manager.npcKnowledge.get(connectedId);
          if (kb) {
            const distorted = distortKnowledge(spread.knowledge, 0.1);
            distorted.source = spread.npcId;
            addKnowledge(kb, distorted);
          }
        }
      }
    }
  }
  
  // Random gossip between connected NPCs
  for (const [npcId, connections] of manager.socialNetwork) {
    if (!aiRng.chance(0.1)) continue; // 10% chance per NPC
    
    const kb = manager.npcKnowledge.get(npcId);
    if (!kb || kb.knowledge.size === 0) continue;
    
    // Pick random knowledge to share
    const knowledgeArray = Array.from(kb.knowledge.values());
    const toShare = aiRng.pick(knowledgeArray);
    
    // Share with random connection
    const connectionArray = Array.from(connections);
    if (connectionArray.length === 0) continue;
    
    const targetId = aiRng.pick(connectionArray);
    const targetKb = manager.npcKnowledge.get(targetId);
    
    if (targetKb) {
      shareKnowledge(kb, targetKb, toShare, npcId);
    }
  }
}
