// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIUtility.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIUtility.js (original) - Utility AI Decision System
 * 
 * Features:
 * - Response curves (linear, exponential, logistic, etc.)
 * - Multi-factor scoring with considerations
 * - Action selection with randomization/bucketing
 * - Context-aware decision making
 */

// ============================================================================
// RESPONSE CURVES
// ============================================================================

/**
 * Linear curve: y = mx + b
 * @param {number} slope - Slope (m)
 * @param {number} intercept - Y-intercept (b)
 * @returns {Function} Curve function
 */
export function linearCurve(slope = 1, intercept = 0) {
  return (x) => Math.max(0, Math.min(1, slope * x + intercept));
}

/**
 * Inverse linear curve: y = 1 - x
 * @returns {Function} Curve function
 */
export function inverseLinearCurve() {
  return (x) => Math.max(0, Math.min(1, 1 - x));
}

/**
 * Quadratic curve: y = (x - offset)^2 * scale
 * @param {number} scale - Scale factor
 * @param {number} offset - X offset
 * @returns {Function} Curve function
 */
export function quadraticCurve(scale = 1, offset = 0) {
  return (x) => {
    const shifted = x - offset;
    return Math.max(0, Math.min(1, shifted * shifted * scale));
  };
}

/**
 * Exponential curve: y = e^(kx) normalized
 * @param {number} k - Exponent factor
 * @returns {Function} Curve function
 */
export function exponentialCurve(k = 2) {
  const maxVal = Math.exp(k);
  return (x) => Math.max(0, Math.min(1, (Math.exp(k * x) - 1) / (maxVal - 1)));
}

/**
 * Logistic (S-curve): y = 1 / (1 + e^(-k(x - midpoint)))
 * @param {number} k - Steepness
 * @param {number} midpoint - X value at y=0.5
 * @returns {Function} Curve function
 */
export function logisticCurve(k = 10, midpoint = 0.5) {
  return (x) => 1 / (1 + Math.exp(-k * (x - midpoint)));
}

/**
 * Smoothstep curve: 3x^2 - 2x^3
 * @returns {Function} Curve function
 */
export function smoothstepCurve() {
  return (x) => {
    const clamped = Math.max(0, Math.min(1, x));
    return clamped * clamped * (3 - 2 * clamped);
  };
}

/**
 * Step curve: returns 0 below threshold, 1 above
 * @param {number} threshold - Step threshold
 * @returns {Function} Curve function
 */
export function stepCurve(threshold = 0.5) {
  return (x) => x >= threshold ? 1 : 0;
}

/**
 * Bell curve (Gaussian-like): peaks at center
 * @param {number} center - Peak position
 * @param {number} width - Width of bell
 * @returns {Function} Curve function
 */
export function bellCurve(center = 0.5, width = 0.3) {
  return (x) => {
    const dist = (x - center) / width;
    return Math.exp(-dist * dist);
  };
}

/**
 * Custom curve from control points (piecewise linear)
 * @param {Array<{x: number, y: number}>} points - Control points sorted by x
 * @returns {Function} Curve function
 */
export function customCurve(points) {
  // Sort by x
  const sorted = [...points].sort((a, b) => a.x - b.x);
  
  return (x) => {
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    
    // Find segment
    for (let i = 0; i < sorted.length - 1; i++) {
      if (x >= sorted[i].x && x <= sorted[i + 1].x) {
        const t = (x - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
        return sorted[i].y + t * (sorted[i + 1].y - sorted[i].y);
      }
    }
    
    return 0;
  };
}

// ============================================================================
// CONSIDERATIONS
// ============================================================================

/**
 * Create a consideration (single scoring factor)
 * @param {string} name - Consideration name
 * @param {Function} inputFn - Function to get normalized input (context) => 0-1
 * @param {Function} curve - Response curve function
 * @param {number} weight - Weight multiplier (default 1)
 * @returns {Object} Consideration
 */
export function createConsideration(name, inputFn, curve, weight = 1) {
  return {
    name,
    inputFn,
    curve,
    weight,
  };
}

/**
 * Evaluate a consideration
 * @param {Object} consideration - Consideration object
 * @param {Object} context - Context data
 * @returns {number} Score 0-1
 */
export function evaluateConsideration(consideration, context) {
  const input = consideration.inputFn(context);
  const curved = consideration.curve(input);
  return curved * consideration.weight;
}

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Create a utility action
 * @param {string} name - Action name
 * @param {Array<Object>} considerations - Array of considerations
 * @param {Function} execute - Execution function (context) => void
 * @param {Object} options - Additional options
 * @returns {Object} Utility action
 */
export function createUtilityAction(name, considerations, execute, options = {}) {
  return {
    name,
    considerations,
    execute,
    cooldown: options.cooldown || 0,
    lastExecuteTime: 0,
    priority: options.priority || 0, // Tiebreaker
    minScore: options.minScore || 0, // Minimum score to consider
  };
}

/**
 * Score an action
 * @param {Object} action - Utility action
 * @param {Object} context - Context data
 * @returns {number} Final score
 */
export function scoreAction(action, context) {
  if (action.considerations.length === 0) return 0;
  
  // Check cooldown
  const now = performance.now();
  if (action.cooldown > 0 && now - action.lastExecuteTime < action.cooldown) {
    return 0;
  }
  
  // Multiply all consideration scores together
  let score = 1;
  for (const consideration of action.considerations) {
    const consScore = evaluateConsideration(consideration, context);
    score *= consScore;
    
    // Early out if score drops to 0
    if (score <= 0) return 0;
  }
  
  // Apply compensation factor for multiple considerations
  // (prevents actions with more considerations from being penalized)
  const compensationFactor = 1 - (1 / action.considerations.length);
  const finalScore = score + (1 - score) * compensationFactor * score;
  
  return finalScore;
}

// ============================================================================
// ACTION SELECTION
// ============================================================================

/**
 * Select best action from candidates
 * @param {Array<Object>} actions - Available actions
 * @param {Object} context - Context data
 * @returns {{action: Object, score: number}|null} Best action or null
 */
export function selectBestAction(actions, context) {
  let bestAction = null;
  let bestScore = -Infinity;
  
  for (const action of actions) {
    const score = scoreAction(action, context);
    
    if (score < action.minScore) continue;
    
    if (score > bestScore || (score === bestScore && action.priority > (bestAction?.priority || 0))) {
      bestScore = score;
      bestAction = action;
    }
  }
  
  return bestAction ? { action: bestAction, score: bestScore } : null;
}

/**
 * Select action with weighted randomization
 * Higher scores = higher chance, but not guaranteed
 * @param {Array<Object>} actions - Available actions
 * @param {Object} context - Context data
 * @param {number} randomFactor - Randomization factor (0 = deterministic, 1 = fully random)
 * @returns {{action: Object, score: number}|null} Selected action
 */
export function selectActionWeighted(actions, context, randomFactor = 0.2) {
  const scored = [];
  let totalScore = 0;
  
  for (const action of actions) {
    const score = scoreAction(action, context);
    if (score < action.minScore) continue;
    
    // Add randomization
    const randomized = score + aiRng.range(-0.5, 0.5) * randomFactor;
    const finalScore = Math.max(0, randomized);
    
    scored.push({ action, score: finalScore });
    totalScore += finalScore;
  }
  
  if (scored.length === 0 || totalScore <= 0) return null;
  
  // Weighted random selection
  const roll = aiRng.float() * totalScore;
  let cumulative = 0;
  
  for (const item of scored) {
    cumulative += item.score;
    if (roll <= cumulative) {
      return item;
    }
  }
  
  return scored[scored.length - 1];
}

/**
 * Select from top N actions (bucketing)
 * @param {Array<Object>} actions - Available actions
 * @param {Object} context - Context data
 * @param {number} bucketSize - Number of top actions to consider
 * @returns {{action: Object, score: number}|null} Selected action
 */
export function selectActionBucketed(actions, context, bucketSize = 3) {
  const scored = [];
  
  for (const action of actions) {
    const score = scoreAction(action, context);
    if (score < action.minScore) continue;
    scored.push({ action, score });
  }
  
  if (scored.length === 0) return null;
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Pick random from top bucket
  const bucket = scored.slice(0, Math.min(bucketSize, scored.length));
  return aiRng.pick(bucket);
}

// ============================================================================
// UTILITY AI BRAIN
// ============================================================================

/**
 * Create a utility AI brain
 * @param {Array<Object>} actions - Available actions
 * @param {Object} options - Brain options
 * @returns {Object} Utility brain
 */
export function createUtilityBrain(actions, options = {}) {
  return {
    actions,
    selectionMethod: options.selectionMethod || "best", // "best", "weighted", "bucketed"
    randomFactor: options.randomFactor || 0.2,
    bucketSize: options.bucketSize || 3,
    currentAction: null,
    lastDecisionTime: 0,
    decisionInterval: options.decisionInterval || 100, // ms between decisions
  };
}

/**
 * Update utility brain and select action
 * @param {Object} brain - Utility brain
 * @param {Object} context - Context data
 * @param {number} now - Current time
 * @returns {{action: Object, score: number}|null} Selected action or null if no change
 */
export function updateUtilityBrain(brain, context, now = performance.now()) {
  // Throttle decisions
  if (now - brain.lastDecisionTime < brain.decisionInterval) {
    return brain.currentAction ? { action: brain.currentAction, score: -1 } : null;
  }
  
  brain.lastDecisionTime = now;
  
  let result;
  switch (brain.selectionMethod) {
    case "weighted":
      result = selectActionWeighted(brain.actions, context, brain.randomFactor);
      break;
    case "bucketed":
      result = selectActionBucketed(brain.actions, context, brain.bucketSize);
      break;
    case "best":
    default:
      result = selectBestAction(brain.actions, context);
  }
  
  if (result) {
    brain.currentAction = result.action;
  }
  
  return result;
}

/**
 * Execute the current action
 * @param {Object} brain - Utility brain
 * @param {Object} context - Context data
 */
export function executeCurrentAction(brain, context) {
  if (!brain.currentAction) return;
  
  brain.currentAction.lastExecuteTime = performance.now();
  brain.currentAction.execute(context);
}

// ============================================================================
// COMMON CONSIDERATIONS
// ============================================================================

/**
 * Create health consideration
 * @param {number} criticalThreshold - Health % considered critical
 * @returns {Object} Consideration
 */
export function createHealthConsideration(criticalThreshold = 0.3) {
  return createConsideration(
    "Health",
    (ctx) => ctx.health / ctx.maxHealth,
    inverseLinearCurve() // Lower health = higher score
  );
}

/**
 * Create distance consideration
 * @param {number} idealDistance - Ideal distance
 * @param {number} maxDistance - Maximum relevant distance
 * @returns {Object} Consideration
 */
export function createDistanceConsideration(idealDistance, maxDistance) {
  return createConsideration(
    "Distance",
    (ctx) => Math.min(ctx.distanceToTarget / maxDistance, 1),
    bellCurve(idealDistance / maxDistance, 0.3) // Peak at ideal distance
  );
}

/**
 * Create ammo consideration
 * @returns {Object} Consideration
 */
export function createAmmoConsideration() {
  return createConsideration(
    "Ammo",
    (ctx) => ctx.currentAmmo / ctx.maxAmmo,
    linearCurve(1, 0)
  );
}

/**
 * Create threat consideration
 * @returns {Object} Consideration
 */
export function createThreatConsideration() {
  return createConsideration(
    "Threat",
    (ctx) => ctx.threatLevel || 0,
    exponentialCurve(2)
  );
}

/**
 * Create cover consideration
 * @returns {Object} Consideration
 */
export function createCoverConsideration() {
  return createConsideration(
    "InCover",
    (ctx) => ctx.isInCover ? 1 : 0,
    linearCurve(1, 0)
  );
}

/**
 * Create line of sight consideration
 * @returns {Object} Consideration
 */
export function createLOSConsideration() {
  return createConsideration(
    "HasLOS",
    (ctx) => ctx.hasLineOfSight ? 1 : 0,
    linearCurve(1, 0)
  );
}

// ============================================================================
// PRESET ACTION SETS
// ============================================================================

/**
 * Create basic combat action set
 * @param {Object} handlers - Action handler functions
 * @returns {Array<Object>} Actions
 */
export function createCombatActions(handlers) {
  return [
    createUtilityAction("Attack", [
      createConsideration("HasTarget", (ctx) => ctx.hasTarget ? 1 : 0, stepCurve(0.5)),
      createConsideration("HasAmmo", (ctx) => ctx.currentAmmo > 0 ? 1 : 0, stepCurve(0.5)),
      createConsideration("HasLOS", (ctx) => ctx.hasLineOfSight ? 1 : 0.2, linearCurve(1, 0)),
      createDistanceConsideration(15, 50),
    ], handlers.attack, { priority: 5 }),
    
    createUtilityAction("TakeCover", [
      createConsideration("NotInCover", (ctx) => ctx.isInCover ? 0 : 1, stepCurve(0.5)),
      createConsideration("UnderFire", (ctx) => ctx.takingFire ? 1 : 0.3, linearCurve(1, 0)),
      createHealthConsideration(0.5),
    ], handlers.takeCover, { priority: 4 }),
    
    createUtilityAction("Reload", [
      createConsideration("NeedsAmmo", (ctx) => 1 - ctx.currentAmmo / ctx.maxAmmo, logisticCurve(10, 0.3)),
      createConsideration("Safe", (ctx) => ctx.isInCover ? 1 : 0.3, linearCurve(1, 0)),
    ], handlers.reload, { cooldown: 2000, priority: 3 }),
    
    createUtilityAction("Retreat", [
      createConsideration("LowHealth", (ctx) => 1 - ctx.health / ctx.maxHealth, exponentialCurve(3)),
      createConsideration("Overwhelmed", (ctx) => Math.min(ctx.nearbyEnemies / 3, 1), linearCurve(1, 0)),
    ], handlers.retreat, { priority: 6, minScore: 0.5 }),
    
    createUtilityAction("Flank", [
      createConsideration("HasTarget", (ctx) => ctx.hasTarget ? 1 : 0, stepCurve(0.5)),
      createConsideration("TargetInCover", (ctx) => ctx.targetInCover ? 1 : 0.2, linearCurve(1, 0)),
      createConsideration("HasTeammates", (ctx) => ctx.teammateCount > 0 ? 1 : 0.5, linearCurve(1, 0)),
    ], handlers.flank, { priority: 2 }),
    
    createUtilityAction("Heal", [
      createConsideration("LowHealth", (ctx) => 1 - ctx.health / ctx.maxHealth, logisticCurve(8, 0.4)),
      createConsideration("HasHealing", (ctx) => ctx.hasHealingItem ? 1 : 0, stepCurve(0.5)),
      createConsideration("Safe", (ctx) => ctx.isInCover ? 1 : 0.5, linearCurve(1, 0)),
    ], handlers.heal, { cooldown: 5000, priority: 7, minScore: 0.4 }),
  ];
}
