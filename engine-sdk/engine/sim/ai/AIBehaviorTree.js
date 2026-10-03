// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIBehaviorTree.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 * 
 * Uses AISchema.js for consistent node type definitions.
 */

import { aiRng } from './AIRandom.js';
import { 
  NODE_STATUS as SCHEMA_NODE_STATUS, 
  NODE_TYPES,
  getNodeTypeId,
} from './AISchema.js';

/**
 * AIBehaviorTree.js (original) - Behavior Tree Implementation
 * 
 * Features:
 * - Composite nodes: Selector, Sequence, Parallel
 * - Decorator nodes: Inverter, Repeater, Succeeder, Failer, UntilFail
 * - Leaf nodes: Action, Condition
 * - Blackboard integration
 * - Tree serialization/deserialization
 */

// ============================================================================
// NODE STATUS (from AISchema)
// ============================================================================

export const NODE_STATUS = {
  SUCCESS: "success",
  FAILURE: "failure",
  RUNNING: "running",
};

// Re-export schema types for external use
export { NODE_TYPES, getNodeTypeId };

// ============================================================================
// BASE NODE
// ============================================================================

/**
 * Base behavior tree node
 * @param {string} type - Node type
 * @param {string} name - Node name for debugging
 * @returns {Object} Base node
 */
function createBaseNode(type, name = "") {
  return {
    type,
    name,
    status: NODE_STATUS.SUCCESS,
  };
}

// ============================================================================
// COMPOSITE NODES
// ============================================================================

/**
 * Create a Selector node (OR logic)
 * Runs children left-to-right, succeeds if ANY child succeeds
 * @param {string} name - Node name
 * @param {Array<Object>} children - Child nodes
 * @returns {Object} Selector node
 */
export function createSelector(name, children = []) {
  return {
    ...createBaseNode("selector", name),
    children,
    currentIndex: 0,
  };
}

/**
 * Create a Sequence node (AND logic)
 * Runs children left-to-right, fails if ANY child fails
 * @param {string} name - Node name
 * @param {Array<Object>} children - Child nodes
 * @returns {Object} Sequence node
 */
export function createSequence(name, children = []) {
  return {
    ...createBaseNode("sequence", name),
    children,
    currentIndex: 0,
  };
}

/**
 * Create a Parallel node
 * Runs all children simultaneously
 * @param {string} name - Node name
 * @param {Array<Object>} children - Child nodes
 * @param {number} successThreshold - Number of successes needed (default: all)
 * @param {number} failureThreshold - Number of failures to fail (default: 1)
 * @returns {Object} Parallel node
 */
export function createParallel(name, children = [], successThreshold = -1, failureThreshold = 1) {
  return {
    ...createBaseNode("parallel", name),
    children,
    successThreshold: successThreshold < 0 ? children.length : successThreshold,
    failureThreshold,
  };
}

/**
 * Create a Random Selector (picks random child)
 * @param {string} name - Node name
 * @param {Array<Object>} children - Child nodes
 * @returns {Object} Random selector node
 */
export function createRandomSelector(name, children = []) {
  return {
    ...createBaseNode("random_selector", name),
    children,
    selectedIndex: -1,
  };
}

// ============================================================================
// DECORATOR NODES
// ============================================================================

/**
 * Create an Inverter decorator
 * Inverts child result: SUCCESS ↔ FAILURE
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @returns {Object} Inverter node
 */
export function createInverter(name, child) {
  return {
    ...createBaseNode("inverter", name),
    child,
  };
}

/**
 * Create a Repeater decorator
 * Repeats child N times or until failure
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @param {number} times - Times to repeat (-1 for infinite)
 * @returns {Object} Repeater node
 */
export function createRepeater(name, child, times = -1) {
  return {
    ...createBaseNode("repeater", name),
    child,
    times,
    count: 0,
  };
}

/**
 * Create an UntilFail decorator
 * Repeats child until it fails
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @returns {Object} UntilFail node
 */
export function createUntilFail(name, child) {
  return {
    ...createBaseNode("until_fail", name),
    child,
  };
}

/**
 * Create an UntilSuccess decorator
 * Repeats child until it succeeds
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @returns {Object} UntilSuccess node
 */
export function createUntilSuccess(name, child) {
  return {
    ...createBaseNode("until_success", name),
    child,
  };
}

/**
 * Create a Succeeder decorator
 * Always returns SUCCESS
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @returns {Object} Succeeder node
 */
export function createSucceeder(name, child) {
  return {
    ...createBaseNode("succeeder", name),
    child,
  };
}

/**
 * Create a Failer decorator
 * Always returns FAILURE
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @returns {Object} Failer node
 */
export function createFailer(name, child) {
  return {
    ...createBaseNode("failer", name),
    child,
  };
}

/**
 * Create a Cooldown decorator
 * Prevents child from running until cooldown expires
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @param {number} cooldownMs - Cooldown in milliseconds
 * @returns {Object} Cooldown node
 */
export function createCooldown(name, child, cooldownMs) {
  return {
    ...createBaseNode("cooldown", name),
    child,
    cooldownMs,
    lastRunTime: 0,
  };
}

/**
 * Create a Condition Guard decorator
 * Only runs child if condition is met
 * @param {string} name - Node name
 * @param {Object} child - Child node
 * @param {Function} condition - Condition function (blackboard) => boolean
 * @returns {Object} Condition guard node
 */
export function createConditionGuard(name, child, condition) {
  return {
    ...createBaseNode("condition_guard", name),
    child,
    condition,
  };
}

// ============================================================================
// LEAF NODES
// ============================================================================

/**
 * Create an Action leaf node
 * @param {string} name - Action name
 * @param {Function} action - Action function (blackboard, deltaTime) => NODE_STATUS
 * @returns {Object} Action node
 */
export function createAction(name, action) {
  return {
    ...createBaseNode("action", name),
    action,
  };
}

/**
 * Create a Condition leaf node
 * @param {string} name - Condition name
 * @param {Function} condition - Condition function (blackboard) => boolean
 * @returns {Object} Condition node
 */
export function createCondition(name, condition) {
  return {
    ...createBaseNode("condition", name),
    condition,
  };
}

/**
 * Create a Wait leaf node
 * @param {string} name - Node name
 * @param {number} durationMs - Wait duration in milliseconds
 * @returns {Object} Wait node
 */
export function createWait(name, durationMs) {
  return {
    ...createBaseNode("wait", name),
    durationMs,
    startTime: 0,
    running: false,
  };
}

/**
 * Create a Log leaf node (for debugging)
 * @param {string} name - Node name
 * @param {string} message - Message to log
 * @returns {Object} Log node
 */
export function createLog(name, message) {
  return {
    ...createBaseNode("log", name),
    message,
  };
}

// ============================================================================
// TREE EXECUTION
// ============================================================================

/**
 * Tick a behavior tree node
 * @param {Object} node - Node to tick
 * @param {Object} blackboard - Blackboard data
 * @param {number} deltaTime - Delta time in ms
 * @returns {string} NODE_STATUS
 */
export function tickNode(node, blackboard, deltaTime) {
  switch (node.type) {
    // Composites
    case "selector":
      return tickSelector(node, blackboard, deltaTime);
    case "sequence":
      return tickSequence(node, blackboard, deltaTime);
    case "parallel":
      return tickParallel(node, blackboard, deltaTime);
    case "random_selector":
      return tickRandomSelector(node, blackboard, deltaTime);
      
    // Decorators
    case "inverter":
      return tickInverter(node, blackboard, deltaTime);
    case "repeater":
      return tickRepeater(node, blackboard, deltaTime);
    case "until_fail":
      return tickUntilFail(node, blackboard, deltaTime);
    case "until_success":
      return tickUntilSuccess(node, blackboard, deltaTime);
    case "succeeder":
      return tickSucceeder(node, blackboard, deltaTime);
    case "failer":
      return tickFailer(node, blackboard, deltaTime);
    case "cooldown":
      return tickCooldown(node, blackboard, deltaTime);
    case "condition_guard":
      return tickConditionGuard(node, blackboard, deltaTime);
      
    // Leaves
    case "action":
      return tickAction(node, blackboard, deltaTime);
    case "condition":
      return tickCondition(node, blackboard);
    case "wait":
      return tickWait(node, blackboard, deltaTime);
    case "log":
      return tickLog(node, blackboard);
      
    default:
      console.warn(`Unknown node type: ${node.type}`);
      return NODE_STATUS.FAILURE;
  }
}

// ============================================================================
// COMPOSITE TICK FUNCTIONS
// ============================================================================

function tickSelector(node, blackboard, deltaTime) {
  for (let i = node.currentIndex; i < node.children.length; i++) {
    const status = tickNode(node.children[i], blackboard, deltaTime);
    
    if (status === NODE_STATUS.RUNNING) {
      node.currentIndex = i;
      node.status = NODE_STATUS.RUNNING;
      return NODE_STATUS.RUNNING;
    }
    
    if (status === NODE_STATUS.SUCCESS) {
      node.currentIndex = 0;
      node.status = NODE_STATUS.SUCCESS;
      return NODE_STATUS.SUCCESS;
    }
  }
  
  node.currentIndex = 0;
  node.status = NODE_STATUS.FAILURE;
  return NODE_STATUS.FAILURE;
}

function tickSequence(node, blackboard, deltaTime) {
  for (let i = node.currentIndex; i < node.children.length; i++) {
    const status = tickNode(node.children[i], blackboard, deltaTime);
    
    if (status === NODE_STATUS.RUNNING) {
      node.currentIndex = i;
      node.status = NODE_STATUS.RUNNING;
      return NODE_STATUS.RUNNING;
    }
    
    if (status === NODE_STATUS.FAILURE) {
      node.currentIndex = 0;
      node.status = NODE_STATUS.FAILURE;
      return NODE_STATUS.FAILURE;
    }
  }
  
  node.currentIndex = 0;
  node.status = NODE_STATUS.SUCCESS;
  return NODE_STATUS.SUCCESS;
}

function tickParallel(node, blackboard, deltaTime) {
  let successCount = 0;
  let failureCount = 0;
  let runningCount = 0;
  
  for (const child of node.children) {
    const status = tickNode(child, blackboard, deltaTime);
    
    if (status === NODE_STATUS.SUCCESS) successCount++;
    else if (status === NODE_STATUS.FAILURE) failureCount++;
    else runningCount++;
  }
  
  if (failureCount >= node.failureThreshold) {
    node.status = NODE_STATUS.FAILURE;
    return NODE_STATUS.FAILURE;
  }
  
  if (successCount >= node.successThreshold) {
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickRandomSelector(node, blackboard, deltaTime) {
  // Select random child on first tick
  if (node.selectedIndex < 0) {
    node.selectedIndex = aiRng.int(node.children.length);
  }
  
  const status = tickNode(node.children[node.selectedIndex], blackboard, deltaTime);
  
  if (status !== NODE_STATUS.RUNNING) {
    node.selectedIndex = -1;
  }
  
  node.status = status;
  return status;
}

// ============================================================================
// DECORATOR TICK FUNCTIONS
// ============================================================================

function tickInverter(node, blackboard, deltaTime) {
  const status = tickNode(node.child, blackboard, deltaTime);
  
  if (status === NODE_STATUS.SUCCESS) {
    node.status = NODE_STATUS.FAILURE;
    return NODE_STATUS.FAILURE;
  }
  if (status === NODE_STATUS.FAILURE) {
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickRepeater(node, blackboard, deltaTime) {
  if (node.times > 0 && node.count >= node.times) {
    node.count = 0;
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  const status = tickNode(node.child, blackboard, deltaTime);
  
  if (status === NODE_STATUS.RUNNING) {
    node.status = NODE_STATUS.RUNNING;
    return NODE_STATUS.RUNNING;
  }
  
  node.count++;
  
  if (status === NODE_STATUS.FAILURE) {
    node.count = 0;
    node.status = NODE_STATUS.FAILURE;
    return NODE_STATUS.FAILURE;
  }
  
  // Continue repeating
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickUntilFail(node, blackboard, deltaTime) {
  const status = tickNode(node.child, blackboard, deltaTime);
  
  if (status === NODE_STATUS.FAILURE) {
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickUntilSuccess(node, blackboard, deltaTime) {
  const status = tickNode(node.child, blackboard, deltaTime);
  
  if (status === NODE_STATUS.SUCCESS) {
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickSucceeder(node, blackboard, deltaTime) {
  tickNode(node.child, blackboard, deltaTime);
  node.status = NODE_STATUS.SUCCESS;
  return NODE_STATUS.SUCCESS;
}

function tickFailer(node, blackboard, deltaTime) {
  tickNode(node.child, blackboard, deltaTime);
  node.status = NODE_STATUS.FAILURE;
  return NODE_STATUS.FAILURE;
}

function tickCooldown(node, blackboard, deltaTime) {
  const now = performance.now();
  
  if (now - node.lastRunTime < node.cooldownMs) {
    node.status = NODE_STATUS.FAILURE;
    return NODE_STATUS.FAILURE;
  }
  
  const status = tickNode(node.child, blackboard, deltaTime);
  
  if (status !== NODE_STATUS.RUNNING) {
    node.lastRunTime = now;
  }
  
  node.status = status;
  return status;
}

function tickConditionGuard(node, blackboard, deltaTime) {
  if (!node.condition(blackboard)) {
    node.status = NODE_STATUS.FAILURE;
    return NODE_STATUS.FAILURE;
  }
  
  const status = tickNode(node.child, blackboard, deltaTime);
  node.status = status;
  return status;
}

// ============================================================================
// LEAF TICK FUNCTIONS
// ============================================================================

function tickAction(node, blackboard, deltaTime) {
  const status = node.action(blackboard, deltaTime);
  node.status = status;
  return status;
}

function tickCondition(node, blackboard) {
  const result = node.condition(blackboard);
  node.status = result ? NODE_STATUS.SUCCESS : NODE_STATUS.FAILURE;
  return node.status;
}

function tickWait(node, blackboard, deltaTime) {
  const now = performance.now();
  
  if (!node.running) {
    node.running = true;
    node.startTime = now;
  }
  
  if (now - node.startTime >= node.durationMs) {
    node.running = false;
    node.status = NODE_STATUS.SUCCESS;
    return NODE_STATUS.SUCCESS;
  }
  
  node.status = NODE_STATUS.RUNNING;
  return NODE_STATUS.RUNNING;
}

function tickLog(node, blackboard) {
  console.log(`[BT] ${node.name}: ${node.message}`);
  node.status = NODE_STATUS.SUCCESS;
  return NODE_STATUS.SUCCESS;
}

// ============================================================================
// TREE MANAGEMENT
// ============================================================================

/**
 * Reset a behavior tree node and all children
 * @param {Object} node - Node to reset
 */
export function resetNode(node) {
  node.status = NODE_STATUS.SUCCESS;
  
  if (node.currentIndex !== undefined) node.currentIndex = 0;
  if (node.count !== undefined) node.count = 0;
  if (node.running !== undefined) node.running = false;
  if (node.selectedIndex !== undefined) node.selectedIndex = -1;
  
  if (node.children) {
    for (const child of node.children) {
      resetNode(child);
    }
  }
  
  if (node.child) {
    resetNode(node.child);
  }
}

/**
 * Create a behavior tree runner
 * @param {Object} rootNode - Root node of tree
 * @param {Object} blackboard - Blackboard data
 * @returns {Object} Tree runner
 */
export function createTreeRunner(rootNode, blackboard) {
  return {
    root: rootNode,
    blackboard,
    isRunning: false,
  };
}

/**
 * Tick the behavior tree
 * @param {Object} runner - Tree runner
 * @param {number} deltaTime - Delta time in ms
 * @returns {string} NODE_STATUS
 */
export function tickTree(runner, deltaTime) {
  runner.isRunning = true;
  const status = tickNode(runner.root, runner.blackboard, deltaTime);
  
  if (status !== NODE_STATUS.RUNNING) {
    runner.isRunning = false;
  }
  
  return status;
}

// ============================================================================
// COMMON BEHAVIOR TREE PATTERNS
// ============================================================================

/**
 * Create a common combat behavior tree
 * @param {Object} actions - Action implementations
 * @returns {Object} Root node
 */
export function createCombatTree(actions) {
  return createSelector("CombatRoot", [
    // Dead check
    createSequence("HandleDeath", [
      createCondition("IsDead", actions.isDead),
      createAction("Die", actions.die),
    ]),
    
    // Combat engaged
    createSequence("CombatEngaged", [
      createCondition("HasTarget", actions.hasTarget),
      createSelector("CombatActions", [
        // Low health - retreat
        createSequence("LowHealthRetreat", [
          createCondition("IsLowHealth", actions.isLowHealth),
          createAction("FindRetreatCover", actions.findRetreatCover),
          createAction("MoveToCover", actions.moveToCover),
        ]),
        
        // In cover - peek and shoot
        createSequence("CoverCombat", [
          createCondition("IsInCover", actions.isInCover),
          createAction("PeekAndShoot", actions.peekAndShoot),
        ]),
        
        // Find cover
        createSequence("FindCover", [
          createCondition("NeedsCover", actions.needsCover),
          createAction("FindCover", actions.findCover),
          createAction("MoveToCover", actions.moveToCover),
        ]),
        
        // Direct attack
        createAction("Attack", actions.attack),
      ]),
    ]),
    
    // Investigating
    createSequence("Investigating", [
      createCondition("HasInvestigationPoint", actions.hasInvestigationPoint),
      createAction("MoveToInvestigate", actions.moveToInvestigate),
      createAction("LookAround", actions.lookAround),
    ]),
    
    // Patrol
    createAction("Patrol", actions.patrol),
  ]);
}
