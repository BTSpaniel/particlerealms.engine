// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIMorale.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';
import { statsMean } from '../../core/math/MathStatistics.js';

/**
 * AIMorale.js (original) - NPC Morale and Psychological State
 * 
 * Features:
 * - Morale tracking (courage/fear)
 * - Panic and suppression states
 * - Rally and leadership effects
 * - Combat effectiveness modifiers
 * - Surrender/flee decisions
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Morale states */
export const MORALE_STATE = {
  CONFIDENT: 4,   // Aggressive, takes risks
  STEADY: 3,      // Normal combat behavior
  SHAKEN: 2,      // Cautious, prefers cover
  BREAKING: 1,    // May flee, poor accuracy
  BROKEN: 0,      // Will flee or surrender
};

/** Default morale parameters */
export const DEFAULT_MORALE_PARAMS = {
  baseMorale: 75,
  maxMorale: 100,
  minMorale: 0,
  
  // Thresholds
  confidentThreshold: 85,
  steadyThreshold: 60,
  shakenThreshold: 40,
  breakingThreshold: 20,
  
  // Recovery
  recoveryRate: 2, // Points per second when safe
  rallyBonus: 15,  // Instant boost when rallied
  
  // Damage
  damageImpact: 0.5, // Morale lost per HP damage
  allyDeathImpact: 10,
  enemyDeathBoost: 5,
  
  // Suppression
  suppressionDecay: 5, // Per second
  suppressionThreshold: 50, // Suppression to enter suppressed state
  
  // Leadership
  leaderRadius: 15,
  leaderBonus: 0.2, // +20% morale effects near leader
};

// ============================================================================
// MORALE STATE
// ============================================================================

/**
 * Create morale state for an NPC
 * @param {Object} params - Morale parameters
 * @returns {Object} Morale state
 */
export function createMoraleState(params = {}) {
  const p = { ...DEFAULT_MORALE_PARAMS, ...params };
  
  return {
    // Current values
    morale: p.baseMorale,
    maxMorale: p.maxMorale,
    suppression: 0,
    
    // State
    state: MORALE_STATE.STEADY,
    isSuppressed: false,
    isPanicking: false,
    hasSurrendered: false,
    
    // Parameters
    params: p,
    
    // Tracking
    lastDamageTime: 0,
    lastAllyDeathTime: 0,
    consecutiveHits: 0,
    timeSinceCombat: 0,
    
    // Modifiers
    leaderNearby: false,
    alliesNearby: 0,
    enemiesVisible: 0,
  };
}

// ============================================================================
// MORALE CHANGES
// ============================================================================

/**
 * Apply morale change
 * @param {Object} state - Morale state
 * @param {number} delta - Change amount (positive = boost, negative = damage)
 */
export function changeMorale(state, delta) {
  // Leader bonus
  const modifier = state.leaderNearby ? (1 + state.params.leaderBonus) : 1;
  const adjustedDelta = delta > 0 ? delta * modifier : delta;
  
  state.morale = Math.max(
    state.params.minMorale,
    Math.min(state.params.maxMorale, state.morale + adjustedDelta)
  );
  
  updateMoraleState(state);
}

/**
 * Apply suppression
 * @param {Object} state - Morale state
 * @param {number} amount - Suppression amount
 */
export function applySuppression(state, amount) {
  state.suppression = Math.min(100, state.suppression + amount);
  state.isSuppressed = state.suppression >= state.params.suppressionThreshold;
  
  // Suppression also damages morale slightly
  changeMorale(state, -amount * 0.1);
}

/**
 * Process taking damage
 * @param {Object} state - Morale state
 * @param {number} damage - Damage amount
 * @param {boolean} fromBehind - Was flanked/surprised
 */
export function processDamageMorale(state, damage, fromBehind = false) {
  const now = performance.now();
  
  // Track consecutive hits
  if (now - state.lastDamageTime < 2000) {
    state.consecutiveHits++;
  } else {
    state.consecutiveHits = 1;
  }
  state.lastDamageTime = now;
  
  // Calculate morale loss
  let loss = damage * state.params.damageImpact;
  
  // Consecutive hit penalty
  loss *= 1 + (state.consecutiveHits * 0.1);
  
  // Flanking penalty
  if (fromBehind) {
    loss *= 1.5;
  }
  
  changeMorale(state, -loss);
  state.timeSinceCombat = 0;
}

/**
 * Process ally death
 * @param {Object} state - Morale state
 * @param {boolean} wasLeader - Was the ally a leader
 */
export function processAllyDeath(state, wasLeader = false) {
  let loss = state.params.allyDeathImpact;
  
  if (wasLeader) {
    loss *= 2.5;
    state.leaderNearby = false;
  }
  
  changeMorale(state, -loss);
  state.lastAllyDeathTime = performance.now();
}

/**
 * Process enemy death
 * @param {Object} state - Morale state
 * @param {boolean} wasLeader - Was the enemy a leader
 */
export function processEnemyDeath(state, wasLeader = false) {
  let boost = state.params.enemyDeathBoost;
  
  if (wasLeader) {
    boost *= 2;
  }
  
  changeMorale(state, boost);
}

/**
 * Rally (leader ability)
 * @param {Object} state - Morale state
 */
export function rally(state) {
  changeMorale(state, state.params.rallyBonus);
  state.isPanicking = false;
  
  // Can't rally from surrender
  if (!state.hasSurrendered && state.state === MORALE_STATE.BROKEN) {
    state.morale = state.params.breakingThreshold + 5;
    updateMoraleState(state);
  }
}

// ============================================================================
// STATE UPDATES
// ============================================================================

/**
 * Update morale state based on current morale level
 * @param {Object} state - Morale state
 */
function updateMoraleState(state) {
  const m = state.morale;
  const p = state.params;
  
  if (m >= p.confidentThreshold) {
    state.state = MORALE_STATE.CONFIDENT;
  } else if (m >= p.steadyThreshold) {
    state.state = MORALE_STATE.STEADY;
  } else if (m >= p.shakenThreshold) {
    state.state = MORALE_STATE.SHAKEN;
  } else if (m >= p.breakingThreshold) {
    state.state = MORALE_STATE.BREAKING;
    state.isPanicking = true;
  } else {
    state.state = MORALE_STATE.BROKEN;
    state.isPanicking = true;
  }
}

/**
 * Update morale over time (recovery, suppression decay)
 * @param {Object} state - Morale state
 * @param {number} deltaTimeSec - Delta time in seconds
 * @param {boolean} inCombat - Currently in combat
 * @param {boolean} inCover - Currently in cover
 */
export function updateMorale(state, deltaTimeSec, inCombat, inCover) {
  // Update combat timer
  if (inCombat) {
    state.timeSinceCombat = 0;
  } else {
    state.timeSinceCombat += deltaTimeSec;
  }
  
  // Suppression decay
  if (state.suppression > 0) {
    state.suppression = Math.max(0, state.suppression - state.params.suppressionDecay * deltaTimeSec);
    state.isSuppressed = state.suppression >= state.params.suppressionThreshold;
  }
  
  // Morale recovery when not in combat
  if (!inCombat && state.timeSinceCombat > 3) {
    let recovery = state.params.recoveryRate * deltaTimeSec;
    
    // Faster recovery in cover
    if (inCover) {
      recovery *= 1.5;
    }
    
    // Faster recovery near allies
    recovery *= 1 + (state.alliesNearby * 0.1);
    
    // Slower recovery if recently took damage
    const timeSinceDamage = (performance.now() - state.lastDamageTime) / 1000;
    if (timeSinceDamage < 5) {
      recovery *= 0.5;
    }
    
    changeMorale(state, recovery);
  }
  
  // Panic check
  if (state.isPanicking && state.morale > state.params.shakenThreshold) {
    state.isPanicking = false;
  }
}

/**
 * Update context (allies, enemies, leader)
 * @param {Object} state - Morale state
 * @param {number} alliesNearby - Number of allies nearby
 * @param {number} enemiesVisible - Number of enemies visible
 * @param {boolean} leaderNearby - Is a leader nearby
 */
export function updateMoraleContext(state, alliesNearby, enemiesVisible, leaderNearby) {
  state.alliesNearby = alliesNearby;
  state.enemiesVisible = enemiesVisible;
  state.leaderNearby = leaderNearby;
  
  // Outnumbered penalty (continuous)
  if (enemiesVisible > alliesNearby + 1) {
    const outnumberedRatio = (enemiesVisible - alliesNearby) / 3;
    // Small continuous drain when heavily outnumbered
    // This will be applied per update in updateMorale
  }
}

// ============================================================================
// COMBAT MODIFIERS
// ============================================================================

/**
 * Get accuracy modifier based on morale
 * @param {Object} state - Morale state
 * @returns {number} Accuracy multiplier (0-1.2)
 */
export function getMoraleAccuracyMod(state) {
  if (state.hasSurrendered) return 0;
  if (state.isSuppressed) return 0.4;
  
  switch (state.state) {
    case MORALE_STATE.CONFIDENT: return 1.1;
    case MORALE_STATE.STEADY: return 1.0;
    case MORALE_STATE.SHAKEN: return 0.85;
    case MORALE_STATE.BREAKING: return 0.6;
    case MORALE_STATE.BROKEN: return 0.3;
    default: return 1.0;
  }
}

/**
 * Get movement speed modifier based on morale
 * @param {Object} state - Morale state
 * @returns {number} Speed multiplier
 */
export function getMoraleSpeedMod(state) {
  if (state.hasSurrendered) return 0;
  
  // Panicking units move faster (fleeing)
  if (state.isPanicking) return 1.3;
  if (state.isSuppressed) return 0.5;
  
  switch (state.state) {
    case MORALE_STATE.CONFIDENT: return 1.1;
    case MORALE_STATE.STEADY: return 1.0;
    case MORALE_STATE.SHAKEN: return 0.9;
    case MORALE_STATE.BREAKING: return 1.2; // Trying to flee
    case MORALE_STATE.BROKEN: return 1.4;   // Full flight
    default: return 1.0;
  }
}

/**
 * Get reaction time modifier based on morale
 * @param {Object} state - Morale state
 * @returns {number} Reaction time multiplier (higher = slower)
 */
export function getMoraleReactionMod(state) {
  if (state.isSuppressed) return 1.8;
  
  switch (state.state) {
    case MORALE_STATE.CONFIDENT: return 0.9;
    case MORALE_STATE.STEADY: return 1.0;
    case MORALE_STATE.SHAKEN: return 1.2;
    case MORALE_STATE.BREAKING: return 1.5;
    case MORALE_STATE.BROKEN: return 2.0;
    default: return 1.0;
  }
}

// ============================================================================
// BEHAVIOR DECISIONS
// ============================================================================

/**
 * Check if NPC should flee
 * @param {Object} state - Morale state
 * @returns {boolean} Should flee
 */
export function shouldFlee(state) {
  if (state.hasSurrendered) return false;
  
  return state.state <= MORALE_STATE.BREAKING && 
         (state.isPanicking || state.morale < state.params.breakingThreshold * 0.5);
}

/**
 * Check if NPC should surrender
 * @param {Object} state - Morale state
 * @param {boolean} canEscape - Is escape possible
 * @returns {boolean} Should surrender
 */
export function shouldSurrender(state, canEscape = true) {
  if (state.hasSurrendered) return true;
  
  // Only surrender if broken and can't escape
  if (state.state === MORALE_STATE.BROKEN && !canEscape) {
    // Random chance based on how broken
    const surrenderChance = (state.params.breakingThreshold - state.morale) / state.params.breakingThreshold;
    if (aiRng.chance(surrenderChance)) {
      state.hasSurrendered = true;
      return true;
    }
  }
  
  return false;
}

/**
 * Check if NPC should take cover
 * @param {Object} state - Morale state
 * @param {boolean} currentlyInCover - Already in cover
 * @returns {boolean} Should seek cover
 */
export function shouldSeekCover(state, currentlyInCover) {
  if (currentlyInCover) return false;
  if (state.hasSurrendered) return false;
  
  // Suppressed always seeks cover
  if (state.isSuppressed) return true;
  
  // Shaken and below prefer cover
  return state.state <= MORALE_STATE.SHAKEN;
}

/**
 * Check if NPC should be aggressive (charge, flank)
 * @param {Object} state - Morale state
 * @returns {boolean} Should be aggressive
 */
export function shouldBeAggressive(state) {
  if (state.hasSurrendered || state.isSuppressed) return false;
  
  return state.state >= MORALE_STATE.CONFIDENT;
}

/**
 * Roll morale check for risky action
 * @param {Object} state - Morale state
 * @param {number} difficulty - Difficulty 0-100 (higher = harder)
 * @returns {boolean} Passed check
 */
export function moraleCheck(state, difficulty) {
  if (state.hasSurrendered) return false;
  
  // Roll based on current morale vs difficulty
  const roll = aiRng.float() * 100;
  const threshold = state.morale - difficulty;
  
  return roll < threshold;
}

// ============================================================================
// GROUP MORALE
// ============================================================================

/**
 * Calculate group morale average
 * @param {Array<Object>} moraleStates - Array of morale states
 * @returns {number} Average morale
 */
export function getGroupMorale(moraleStates) {
  if (moraleStates.length === 0) return 50;
  
  return statsMean(moraleStates.map((state) => state.morale));
}

/**
 * Check if group is routing (majority broken)
 * @param {Array<Object>} moraleStates - Array of morale states
 * @returns {boolean} Group is routing
 */
export function isGroupRouting(moraleStates) {
  if (moraleStates.length === 0) return false;
  
  let brokenCount = 0;
  for (const state of moraleStates) {
    if (state.state <= MORALE_STATE.BREAKING) {
      brokenCount++;
    }
  }
  
  return brokenCount > moraleStates.length * 0.5;
}

/**
 * Apply group rally (leader ability affecting all nearby)
 * @param {Array<Object>} moraleStates - Array of morale states
 */
export function groupRally(moraleStates) {
  for (const state of moraleStates) {
    rally(state);
  }
}
