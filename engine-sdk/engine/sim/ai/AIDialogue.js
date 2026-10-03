// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIDialogue.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIDialogue.js (original) - Conversation and Dialogue System
 * 
 * Features:
 * - Dialogue trees with branching
 * - Condition-based responses
 * - Mood and relationship-aware dialogue
 * - Dynamic text substitution
 * - Conversation state tracking
 */

// ============================================================================
// DIALOGUE NODE TYPES
// ============================================================================

/** Node types */
export const NODE_TYPE = {
  NPC_LINE: "npc_line",       // NPC speaks
  PLAYER_CHOICE: "player_choice", // Player chooses
  CONDITION: "condition",      // Branch based on condition
  ACTION: "action",           // Trigger game action
  RANDOM: "random",           // Random selection
  SET_FLAG: "set_flag",       // Set dialogue flag
  END: "end",                 // End conversation
};

// ============================================================================
// DIALOGUE TREE
// ============================================================================

/**
 * Create a dialogue tree
 * @param {string} id - Tree ID
 * @param {Object} config - Tree config
 * @returns {Object} Dialogue tree
 */
export function createDialogueTree(id, config = {}) {
  return {
    id,
    name: config.name || id,
    
    // Starting node
    startNodeId: config.startNodeId || "start",
    
    // All nodes
    nodes: new Map(),
    
    // Conditions required to start this dialogue
    prerequisites: config.prerequisites || [],
    
    // Priority for dialogue selection
    priority: config.priority ?? 0,
    
    // Is this a one-time dialogue
    oneTime: config.oneTime ?? false,
    hasPlayed: false,
  };
}

/**
 * Create a dialogue node
 * @param {Object} config - Node config
 * @returns {Object} Dialogue node
 */
export function createDialogueNode(config) {
  return {
    id: config.id,
    type: config.type || NODE_TYPE.NPC_LINE,
    
    // Content
    text: config.text || "",
    speaker: config.speaker || "npc",
    
    // For player choices
    choices: config.choices || [], // [{text, nextNodeId, conditions}]
    
    // For NPC lines
    nextNodeId: config.nextNodeId || null,
    
    // For conditions
    condition: config.condition || null,
    trueNodeId: config.trueNodeId || null,
    falseNodeId: config.falseNodeId || null,
    
    // For random
    randomOptions: config.randomOptions || [], // [{nodeId, weight}]
    
    // For actions
    action: config.action || null, // {type, params}
    
    // For set_flag
    flagName: config.flagName || null,
    flagValue: config.flagValue ?? true,
    
    // Emotion/tone
    emotion: config.emotion || "neutral",
    
    // Animation trigger
    animation: config.animation || null,
    
    // Sound effect
    sound: config.sound || null,
  };
}

/**
 * Add node to dialogue tree
 * @param {Object} tree - Dialogue tree
 * @param {Object} node - Node to add
 */
export function addDialogueNode(tree, node) {
  tree.nodes.set(node.id, node);
}

// ============================================================================
// DIALOGUE STATE
// ============================================================================

/**
 * Create dialogue state for an NPC
 * @returns {Object} Dialogue state
 */
export function createDialogueState() {
  return {
    // Available dialogue trees
    dialogueTrees: new Map(), // id → tree
    
    // Flags for conditional dialogue
    flags: new Map(),
    
    // Current conversation
    currentTree: null,
    currentNodeId: null,
    isInConversation: false,
    
    // History
    conversationHistory: [], // Recent lines spoken
    playedTrees: new Set(),  // Trees that have played (for one-time)
    
    // Mood affects dialogue selection
    mood: 0, // -1 to 1
  };
}

/**
 * Add dialogue tree to NPC
 * @param {Object} state - Dialogue state
 * @param {Object} tree - Dialogue tree
 */
export function addDialogueTree(state, tree) {
  state.dialogueTrees.set(tree.id, tree);
}

/**
 * Set dialogue flag
 * @param {Object} state - Dialogue state
 * @param {string} flag - Flag name
 * @param {*} value - Flag value
 */
export function setDialogueFlag(state, flag, value) {
  state.flags.set(flag, value);
}

/**
 * Get dialogue flag
 * @param {Object} state - Dialogue state
 * @param {string} flag - Flag name
 * @param {*} defaultValue - Default if not set
 * @returns {*} Flag value
 */
export function getDialogueFlag(state, flag, defaultValue = null) {
  return state.flags.has(flag) ? state.flags.get(flag) : defaultValue;
}

// ============================================================================
// CONVERSATION MANAGEMENT
// ============================================================================

/**
 * Start conversation with NPC
 * @param {Object} state - Dialogue state
 * @param {Object} context - Conversation context {playerId, relationship, etc.}
 * @returns {Object|null} First dialogue result
 */
export function startConversation(state, context = {}) {
  // Find best available dialogue tree
  const tree = selectDialogueTree(state, context);
  
  if (!tree) {
    return null;
  }
  
  state.currentTree = tree;
  state.currentNodeId = tree.startNodeId;
  state.isInConversation = true;
  
  return processCurrentNode(state, context);
}

/**
 * Select appropriate dialogue tree
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {Object|null} Selected tree
 */
function selectDialogueTree(state, context) {
  let bestTree = null;
  let bestPriority = -Infinity;
  
  for (const [, tree] of state.dialogueTrees) {
    // Skip played one-time dialogues
    if (tree.oneTime && state.playedTrees.has(tree.id)) continue;
    
    // Check prerequisites
    if (!checkConditions(tree.prerequisites, state, context)) continue;
    
    // Check priority
    if (tree.priority > bestPriority) {
      bestPriority = tree.priority;
      bestTree = tree;
    }
  }
  
  return bestTree;
}

/**
 * Process current dialogue node
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {Object} Dialogue result
 */
export function processCurrentNode(state, context = {}) {
  if (!state.currentTree || !state.currentNodeId) {
    return { type: "end" };
  }
  
  const node = state.currentTree.nodes.get(state.currentNodeId);
  if (!node) {
    return { type: "end" };
  }
  
  switch (node.type) {
    case NODE_TYPE.NPC_LINE:
      return processNPCLine(state, node, context);
      
    case NODE_TYPE.PLAYER_CHOICE:
      return processPlayerChoice(state, node, context);
      
    case NODE_TYPE.CONDITION:
      return processCondition(state, node, context);
      
    case NODE_TYPE.ACTION:
      return processAction(state, node, context);
      
    case NODE_TYPE.RANDOM:
      return processRandom(state, node, context);
      
    case NODE_TYPE.SET_FLAG:
      return processSetFlag(state, node, context);
      
    case NODE_TYPE.END:
    default:
      return endConversation(state);
  }
}

/**
 * Process NPC line node
 */
function processNPCLine(state, node, context) {
  const text = substituteText(node.text, state, context);
  
  state.conversationHistory.push({
    speaker: node.speaker,
    text,
    timestamp: performance.now(),
  });
  
  // Auto-advance to next node
  state.currentNodeId = node.nextNodeId;
  
  return {
    type: "npc_line",
    speaker: node.speaker,
    text,
    emotion: node.emotion,
    animation: node.animation,
    sound: node.sound,
    hasNext: node.nextNodeId !== null,
  };
}

/**
 * Process player choice node
 */
function processPlayerChoice(state, node, context) {
  const availableChoices = [];
  
  for (let i = 0; i < node.choices.length; i++) {
    const choice = node.choices[i];
    
    // Check conditions
    if (choice.conditions && !checkConditions(choice.conditions, state, context)) {
      continue;
    }
    
    availableChoices.push({
      index: i,
      text: substituteText(choice.text, state, context),
      nextNodeId: choice.nextNodeId,
    });
  }
  
  return {
    type: "player_choice",
    choices: availableChoices,
  };
}

/**
 * Select player choice
 * @param {Object} state - Dialogue state
 * @param {number} choiceIndex - Choice index
 * @param {Object} context - Context
 * @returns {Object} Next dialogue result
 */
export function selectChoice(state, choiceIndex, context = {}) {
  const node = state.currentTree.nodes.get(state.currentNodeId);
  if (!node || node.type !== NODE_TYPE.PLAYER_CHOICE) {
    return { type: "error", message: "No choice available" };
  }
  
  const choice = node.choices[choiceIndex];
  if (!choice) {
    return { type: "error", message: "Invalid choice" };
  }
  
  // Record player response
  state.conversationHistory.push({
    speaker: "player",
    text: choice.text,
    timestamp: performance.now(),
  });
  
  state.currentNodeId = choice.nextNodeId;
  
  return processCurrentNode(state, context);
}

/**
 * Process condition node
 */
function processCondition(state, node, context) {
  const result = evaluateCondition(node.condition, state, context);
  
  state.currentNodeId = result ? node.trueNodeId : node.falseNodeId;
  
  return processCurrentNode(state, context);
}

/**
 * Process action node
 */
function processAction(state, node, context) {
  state.currentNodeId = node.nextNodeId;
  
  return {
    type: "action",
    action: node.action,
    continueResult: processCurrentNode(state, context),
  };
}

/**
 * Process random node
 */
function processRandom(state, node, context) {
  // Weighted random selection
  const totalWeight = node.randomOptions.reduce((sum, opt) => sum + (opt.weight || 1), 0);
  let roll = aiRng.float() * totalWeight;
  
  for (const option of node.randomOptions) {
    roll -= option.weight || 1;
    if (roll <= 0) {
      state.currentNodeId = option.nodeId;
      break;
    }
  }
  
  return processCurrentNode(state, context);
}

/**
 * Process set flag node
 */
function processSetFlag(state, node, context) {
  setDialogueFlag(state, node.flagName, node.flagValue);
  state.currentNodeId = node.nextNodeId;
  
  return processCurrentNode(state, context);
}

/**
 * End conversation
 */
function endConversation(state) {
  if (state.currentTree?.oneTime) {
    state.playedTrees.add(state.currentTree.id);
    state.currentTree.hasPlayed = true;
  }
  
  state.currentTree = null;
  state.currentNodeId = null;
  state.isInConversation = false;
  
  return { type: "end" };
}

/**
 * Continue to next dialogue (for NPC lines)
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {Object} Next dialogue result
 */
export function continueDialogue(state, context = {}) {
  return processCurrentNode(state, context);
}

// ============================================================================
// CONDITIONS
// ============================================================================

/**
 * Check array of conditions
 * @param {Array} conditions - Conditions to check
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {boolean} All conditions met
 */
function checkConditions(conditions, state, context) {
  if (!conditions || conditions.length === 0) return true;
  
  for (const condition of conditions) {
    if (!evaluateCondition(condition, state, context)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Evaluate single condition
 * @param {Object} condition - Condition to evaluate
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {boolean} Condition met
 */
function evaluateCondition(condition, state, context) {
  if (!condition) return true;
  
  switch (condition.type) {
    case "flag":
      return getDialogueFlag(state, condition.flag) === condition.value;
      
    case "flag_not":
      return getDialogueFlag(state, condition.flag) !== condition.value;
      
    case "has_flag":
      return state.flags.has(condition.flag);
      
    case "mood_above":
      return state.mood >= condition.value;
      
    case "mood_below":
      return state.mood <= condition.value;
      
    case "relationship":
      return (context.relationship || 0) >= condition.value;
      
    case "has_item":
      return context.playerInventory?.includes(condition.item);
      
    case "quest_complete":
      return context.completedQuests?.includes(condition.quest);
      
    case "custom":
      return condition.evaluate ? condition.evaluate(state, context) : true;
      
    default:
      return true;
  }
}

// ============================================================================
// TEXT SUBSTITUTION
// ============================================================================

/**
 * Substitute variables in dialogue text
 * @param {string} text - Text with placeholders
 * @param {Object} state - Dialogue state
 * @param {Object} context - Context
 * @returns {string} Substituted text
 */
function substituteText(text, state, context) {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    // Check context first
    if (context[key] !== undefined) return context[key];
    
    // Check flags
    if (state.flags.has(key)) return state.flags.get(key);
    
    // Common substitutions
    switch (key) {
      case "playerName":
        return context.playerName || "Adventurer";
      case "npcName":
        return context.npcName || "NPC";
      case "time":
        return context.timeOfDay || "day";
      default:
        return match;
    }
  });
}

// ============================================================================
// DIALOGUE BUILDER
// ============================================================================

/**
 * Fluent dialogue tree builder
 * @param {string} id - Tree ID
 * @returns {Object} Builder
 */
export function dialogueBuilder(id) {
  const tree = createDialogueTree(id);
  let currentNodeId = null;
  
  const builder = {
    name(name) {
      tree.name = name;
      return builder;
    },
    
    priority(p) {
      tree.priority = p;
      return builder;
    },
    
    oneTime(val = true) {
      tree.oneTime = val;
      return builder;
    },
    
    prerequisite(condition) {
      tree.prerequisites.push(condition);
      return builder;
    },
    
    node(id) {
      currentNodeId = id;
      if (!tree.nodes.has(id)) {
        tree.nodes.set(id, createDialogueNode({ id }));
      }
      return builder;
    },
    
    npcSays(text, options = {}) {
      const node = tree.nodes.get(currentNodeId);
      node.type = NODE_TYPE.NPC_LINE;
      node.text = text;
      Object.assign(node, options);
      return builder;
    },
    
    playerChooses(choices) {
      const node = tree.nodes.get(currentNodeId);
      node.type = NODE_TYPE.PLAYER_CHOICE;
      node.choices = choices;
      return builder;
    },
    
    thenGoto(nodeId) {
      const node = tree.nodes.get(currentNodeId);
      node.nextNodeId = nodeId;
      return builder;
    },
    
    end() {
      const node = tree.nodes.get(currentNodeId);
      node.type = NODE_TYPE.END;
      return builder;
    },
    
    build() {
      return tree;
    },
  };
  
  return builder;
}
