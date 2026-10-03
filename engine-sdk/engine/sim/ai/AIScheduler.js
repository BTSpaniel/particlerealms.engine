// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIScheduler.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';
import { statsMean } from '../../core/math/MathStatistics.js';

/**
 * AIScheduler.js (original) - Daily Routines, Needs, and Activities
 * 
 * Like The Sims:
 * - Need satisfaction system
 * - Daily schedules and routines
 * - Activity selection based on needs
 * - Time-aware behavior
 */

// ============================================================================
// NEEDS SYSTEM
// ============================================================================

/** Basic need types */
export const NEED = {
  HUNGER: "hunger",
  ENERGY: "energy",
  SOCIAL: "social",
  FUN: "fun",
  HYGIENE: "hygiene",
  BLADDER: "bladder",
  COMFORT: "comfort",
  SAFETY: "safety",
};

/** Need urgency thresholds */
export const URGENCY = {
  CRITICAL: 0.2,  // Below this = critical
  LOW: 0.4,       // Below this = low
  NORMAL: 0.7,    // Below this = normal
  HIGH: 1.0,      // Full
};

/**
 * Create needs state
 * @param {Object} initial - Initial values (0-1)
 * @returns {Object} Needs state
 */
export function createNeedsState(initial = {}) {
  return {
    [NEED.HUNGER]: initial.hunger ?? 0.8,
    [NEED.ENERGY]: initial.energy ?? 1.0,
    [NEED.SOCIAL]: initial.social ?? 0.7,
    [NEED.FUN]: initial.fun ?? 0.6,
    [NEED.HYGIENE]: initial.hygiene ?? 0.9,
    [NEED.BLADDER]: initial.bladder ?? 0.8,
    [NEED.COMFORT]: initial.comfort ?? 0.7,
    [NEED.SAFETY]: initial.safety ?? 1.0,
    
    // Decay rates per game hour
    decayRates: {
      [NEED.HUNGER]: 0.04,
      [NEED.ENERGY]: 0.03,
      [NEED.SOCIAL]: 0.02,
      [NEED.FUN]: 0.03,
      [NEED.HYGIENE]: 0.02,
      [NEED.BLADDER]: 0.05,
      [NEED.COMFORT]: 0.01,
      [NEED.SAFETY]: 0.01,
    },
  };
}

/**
 * Update needs over time
 * @param {Object} needs - Needs state
 * @param {number} gameHours - Game hours elapsed
 */
export function updateNeeds(needs, gameHours) {
  for (const need of Object.values(NEED)) {
    const decay = needs.decayRates[need] * gameHours;
    needs[need] = Math.max(0, needs[need] - decay);
  }
}

/**
 * Satisfy a need
 * @param {Object} needs - Needs state
 * @param {string} need - Need type
 * @param {number} amount - Satisfaction amount (0-1)
 */
export function satisfyNeed(needs, need, amount) {
  needs[need] = Math.min(1, needs[need] + amount);
}

/**
 * Get most urgent need
 * @param {Object} needs - Needs state
 * @returns {{need: string, value: number, urgency: string}} Most urgent need
 */
export function getMostUrgentNeed(needs) {
  let lowestNeed = null;
  let lowestValue = Infinity;
  
  for (const need of Object.values(NEED)) {
    if (needs[need] < lowestValue) {
      lowestValue = needs[need];
      lowestNeed = need;
    }
  }
  
  let urgency = "high";
  if (lowestValue < URGENCY.CRITICAL) urgency = "critical";
  else if (lowestValue < URGENCY.LOW) urgency = "low";
  else if (lowestValue < URGENCY.NORMAL) urgency = "normal";
  
  return { need: lowestNeed, value: lowestValue, urgency };
}

/**
 * Get all critical needs
 * @param {Object} needs - Needs state
 * @returns {Array<string>} Critical needs
 */
export function getCriticalNeeds(needs) {
  const critical = [];
  for (const need of Object.values(NEED)) {
    if (needs[need] < URGENCY.CRITICAL) {
      critical.push(need);
    }
  }
  return critical;
}

/**
 * Calculate overall wellbeing
 * @param {Object} needs - Needs state
 * @returns {number} Wellbeing 0-1
 */
export function calculateWellbeing(needs) {
  return statsMean(Object.values(NEED).map((need) => needs[need]));
}

// ============================================================================
// ACTIVITIES
// ============================================================================

/**
 * Create an activity definition
 * @param {Object} config - Activity config
 * @returns {Object} Activity
 */
export function createActivity(config) {
  return {
    id: config.id,
    name: config.name,
    
    // Need effects (per hour of activity)
    needEffects: config.needEffects || {},
    
    // Requirements
    requirements: config.requirements || {}, // {need: minValue}
    requiredObjects: config.requiredObjects || [], // Smart object types needed
    requiredLocation: config.requiredLocation || null,
    
    // Timing
    duration: config.duration || 1, // Game hours
    interruptible: config.interruptible ?? true,
    
    // Schedule constraints
    validHours: config.validHours || null, // {start: 0, end: 24} or null for anytime
    
    // Priority boost when certain needs are low
    priorityBoosts: config.priorityBoosts || {}, // {need: multiplier}
  };
}

/**
 * Score an activity based on needs
 * @param {Object} activity - Activity definition
 * @param {Object} needs - Current needs
 * @param {number} gameHour - Current game hour (0-24)
 * @returns {number} Activity score
 */
export function scoreActivity(activity, needs, gameHour = 12) {
  // Check time constraints
  if (activity.validHours) {
    const { start, end } = activity.validHours;
    if (start < end) {
      if (gameHour < start || gameHour > end) return 0;
    } else {
      // Overnight range (e.g., 22-6)
      if (gameHour < start && gameHour > end) return 0;
    }
  }
  
  // Check requirements
  for (const [need, minValue] of Object.entries(activity.requirements)) {
    if (needs[need] < minValue) return 0;
  }
  
  // Calculate base score from need effects
  let score = 0;
  for (const [need, effect] of Object.entries(activity.needEffects)) {
    if (effect > 0) {
      // Positive effect - score higher if need is low
      const needDeficit = 1 - needs[need];
      score += effect * needDeficit;
    }
  }
  
  // Apply priority boosts
  for (const [need, multiplier] of Object.entries(activity.priorityBoosts)) {
    if (needs[need] < URGENCY.LOW) {
      score *= multiplier;
    }
  }
  
  return score;
}

/**
 * Select best activity from options
 * @param {Array<Object>} activities - Available activities
 * @param {Object} needs - Current needs
 * @param {number} gameHour - Current game hour
 * @returns {Object|null} Best activity
 */
export function selectActivity(activities, needs, gameHour = 12) {
  let bestActivity = null;
  let bestScore = 0;
  
  for (const activity of activities) {
    const score = scoreActivity(activity, needs, gameHour);
    if (score > bestScore) {
      bestScore = score;
      bestActivity = activity;
    }
  }
  
  return bestActivity;
}

// ============================================================================
// DAILY SCHEDULE
// ============================================================================

/**
 * Create a daily schedule
 * @returns {Object} Schedule
 */
export function createSchedule() {
  return {
    entries: [], // [{hour, activity, priority, days}]
    currentEntry: null,
    currentStartTime: 0,
  };
}

/**
 * Add scheduled entry
 * @param {Object} schedule - Schedule
 * @param {number} hour - Hour to start (0-24)
 * @param {string} activityId - Activity ID
 * @param {number} priority - Override priority
 * @param {Array<number>} days - Days active (0=Sun, 1=Mon, etc.), null=all
 */
export function addScheduleEntry(schedule, hour, activityId, priority = 1, days = null) {
  schedule.entries.push({
    hour,
    activityId,
    priority,
    days,
  });
  
  // Sort by hour
  schedule.entries.sort((a, b) => a.hour - b.hour);
}

/**
 * Get scheduled activity for time
 * @param {Object} schedule - Schedule
 * @param {number} gameHour - Current hour
 * @param {number} dayOfWeek - Day (0-6)
 * @returns {Object|null} Schedule entry
 */
export function getScheduledActivity(schedule, gameHour, dayOfWeek = 0) {
  let bestEntry = null;
  
  for (const entry of schedule.entries) {
    // Check day constraint
    if (entry.days && !entry.days.includes(dayOfWeek)) continue;
    
    // Find most recent scheduled activity before current hour
    if (entry.hour <= gameHour) {
      bestEntry = entry;
    }
  }
  
  // Check wrap-around (late night schedule from previous day)
  if (!bestEntry && schedule.entries.length > 0) {
    const lastEntry = schedule.entries[schedule.entries.length - 1];
    if (lastEntry.hour > gameHour) {
      // Check if it's valid for today
      if (!lastEntry.days || lastEntry.days.includes((dayOfWeek + 6) % 7)) {
        bestEntry = lastEntry;
      }
    }
  }
  
  return bestEntry;
}

// ============================================================================
// JOB SYSTEM
// ============================================================================

/** Job types */
export const JOB_TYPE = {
  NONE: "none",
  GUARD: "guard",
  MERCHANT: "merchant",
  FARMER: "farmer",
  BLACKSMITH: "blacksmith",
  INNKEEPER: "innkeeper",
  PRIEST: "priest",
  SOLDIER: "soldier",
  MINER: "miner",
  HUNTER: "hunter",
};

/**
 * Create job definition
 * @param {Object} config - Job config
 * @returns {Object} Job definition
 */
export function createJob(config) {
  return {
    id: config.id,
    type: config.type || JOB_TYPE.NONE,
    name: config.name,
    
    // Work schedule
    workHours: config.workHours || { start: 9, end: 17 },
    workDays: config.workDays || [1, 2, 3, 4, 5], // Mon-Fri
    
    // Location
    workLocation: config.workLocation || null,
    
    // Activities performed during work
    workActivities: config.workActivities || [],
    
    // Pay/rewards
    hourlyPay: config.hourlyPay || 0,
    
    // Required skills
    requiredSkills: config.requiredSkills || {},
  };
}

/**
 * Check if currently work hours
 * @param {Object} job - Job definition
 * @param {number} gameHour - Current hour
 * @param {number} dayOfWeek - Day (0-6)
 * @returns {boolean} Is work time
 */
export function isWorkTime(job, gameHour, dayOfWeek) {
  if (!job.workDays.includes(dayOfWeek)) return false;
  
  const { start, end } = job.workHours;
  return gameHour >= start && gameHour < end;
}

// ============================================================================
// COMPLETE NPC SCHEDULER
// ============================================================================

/**
 * Create NPC scheduler
 * @param {Object} config - Configuration
 * @returns {Object} NPC scheduler
 */
export function createNPCScheduler(config = {}) {
  return {
    needs: createNeedsState(config.initialNeeds),
    schedule: createSchedule(),
    job: config.job || null,
    
    // Current state
    currentActivity: null,
    activityStartTime: 0,
    activityProgress: 0,
    
    // Available activities (set by game)
    availableActivities: config.activities || [],
    
    // Autonomy settings
    autonomyEnabled: config.autonomyEnabled ?? true,
    scheduleOverridesAutonomy: config.scheduleOverridesAutonomy ?? true,
  };
}

/**
 * Update NPC scheduler
 * @param {Object} scheduler - NPC scheduler
 * @param {number} gameHour - Current game hour
 * @param {number} dayOfWeek - Day of week
 * @param {number} deltaGameHours - Time elapsed
 * @returns {{newActivity: boolean, activity: Object|null}}
 */
export function updateScheduler(scheduler, gameHour, dayOfWeek, deltaGameHours) {
  // Update needs
  updateNeeds(scheduler.needs, deltaGameHours);
  
  // Check critical needs first
  const criticalNeeds = getCriticalNeeds(scheduler.needs);
  if (criticalNeeds.length > 0) {
    // Find activity that addresses critical need
    for (const activity of scheduler.availableActivities) {
      for (const critNeed of criticalNeeds) {
        if (activity.needEffects[critNeed] > 0) {
          if (scheduler.currentActivity?.id !== activity.id) {
            scheduler.currentActivity = activity;
            scheduler.activityStartTime = gameHour;
            scheduler.activityProgress = 0;
            return { newActivity: true, activity };
          }
        }
      }
    }
  }
  
  // Check job
  if (scheduler.job && isWorkTime(scheduler.job, gameHour, dayOfWeek)) {
    // Should be working - select work activity
    if (scheduler.job.workActivities.length > 0) {
      const workActivity = aiRng.pick(scheduler.job.workActivities);
      if (scheduler.currentActivity?.id !== workActivity.id) {
        scheduler.currentActivity = workActivity;
        scheduler.activityStartTime = gameHour;
        scheduler.activityProgress = 0;
        return { newActivity: true, activity: workActivity };
      }
    }
  }
  
  // Check schedule
  if (scheduler.scheduleOverridesAutonomy) {
    const scheduled = getScheduledActivity(scheduler.schedule, gameHour, dayOfWeek);
    if (scheduled) {
      const activity = scheduler.availableActivities.find(a => a.id === scheduled.activityId);
      if (activity && scheduler.currentActivity?.id !== activity.id) {
        scheduler.currentActivity = activity;
        scheduler.activityStartTime = gameHour;
        scheduler.activityProgress = 0;
        return { newActivity: true, activity };
      }
    }
  }
  
  // Autonomous selection
  if (scheduler.autonomyEnabled) {
    // Check if current activity is complete
    if (scheduler.currentActivity) {
      scheduler.activityProgress += deltaGameHours / scheduler.currentActivity.duration;
      
      if (scheduler.activityProgress >= 1) {
        // Apply need effects
        for (const [need, effect] of Object.entries(scheduler.currentActivity.needEffects)) {
          satisfyNeed(scheduler.needs, need, effect);
        }
        scheduler.currentActivity = null;
      }
    }
    
    // Select new activity if needed
    if (!scheduler.currentActivity) {
      const activity = selectActivity(scheduler.availableActivities, scheduler.needs, gameHour);
      if (activity) {
        scheduler.currentActivity = activity;
        scheduler.activityStartTime = gameHour;
        scheduler.activityProgress = 0;
        return { newActivity: true, activity };
      }
    }
  }
  
  return { newActivity: false, activity: scheduler.currentActivity };
}

// ============================================================================
// PRESET ACTIVITIES
// ============================================================================

export const PRESET_ACTIVITIES = {
  sleep: createActivity({
    id: "sleep",
    name: "Sleep",
    needEffects: { [NEED.ENERGY]: 0.4, [NEED.COMFORT]: 0.1 },
    validHours: { start: 21, end: 7 },
    duration: 8,
    interruptible: true,
    priorityBoosts: { [NEED.ENERGY]: 3 },
  }),
  
  eat: createActivity({
    id: "eat",
    name: "Eat",
    needEffects: { [NEED.HUNGER]: 0.5, [NEED.ENERGY]: 0.1 },
    duration: 0.5,
    priorityBoosts: { [NEED.HUNGER]: 4 },
  }),
  
  socialize: createActivity({
    id: "socialize",
    name: "Socialize",
    needEffects: { [NEED.SOCIAL]: 0.3, [NEED.FUN]: 0.2 },
    duration: 1,
    priorityBoosts: { [NEED.SOCIAL]: 2 },
  }),
  
  relax: createActivity({
    id: "relax",
    name: "Relax",
    needEffects: { [NEED.FUN]: 0.3, [NEED.COMFORT]: 0.2, [NEED.ENERGY]: 0.1 },
    duration: 1,
  }),
  
  bathe: createActivity({
    id: "bathe",
    name: "Bathe",
    needEffects: { [NEED.HYGIENE]: 0.8, [NEED.COMFORT]: 0.2 },
    duration: 0.5,
    priorityBoosts: { [NEED.HYGIENE]: 3 },
  }),
  
  use_bathroom: createActivity({
    id: "use_bathroom",
    name: "Use Bathroom",
    needEffects: { [NEED.BLADDER]: 1.0 },
    duration: 0.1,
    priorityBoosts: { [NEED.BLADDER]: 5 },
  }),
  
  patrol: createActivity({
    id: "patrol",
    name: "Patrol",
    needEffects: { [NEED.SAFETY]: 0.1 },
    duration: 2,
  }),
  
  guard: createActivity({
    id: "guard",
    name: "Guard",
    needEffects: { [NEED.SAFETY]: 0.05 },
    requirements: { [NEED.ENERGY]: 0.2 },
    duration: 4,
  }),
};
