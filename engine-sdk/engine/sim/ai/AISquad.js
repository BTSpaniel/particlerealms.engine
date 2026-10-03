// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AISquad.js - Squad coordination and communication
 * 
 * Inspired by F.E.A.R.'s emergent squad behaviors:
 * - Impromptu squad formation based on proximity
 * - Coordinated flanking maneuvers
 * - Covering fire while allies move
 * - Communication barks (verbal callouts)
 * - Suppression fire coordination
 */

import {
  vec3Sub,
  vec3Add,
  vec3Scale,
  vec3Dot,
  vec3Length,
  vec3Normalize,
} from "../../core/math/EngineMath.js";
import { distance, distanceSquared } from "./AIAiming.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Squad roles */
export const SQUAD_ROLE = {
  NONE: 0,
  LEADER: 1,
  FLANKER_LEFT: 2,
  FLANKER_RIGHT: 3,
  SUPPRESSOR: 4,
  POINT: 5,
  REAR_GUARD: 6,
};

/** Communication bark types */
export const BARK_TYPE = {
  // Combat callouts
  ENEMY_SPOTTED: "enemy_spotted",
  ENEMY_DOWN: "enemy_down",
  TAKING_FIRE: "taking_fire",
  RELOADING: "reloading",
  GRENADE_OUT: "grenade_out",
  GRENADE_INCOMING: "grenade_incoming",
  
  // Tactical callouts
  FLANKING: "flanking",
  COVERING_FIRE: "covering_fire",
  SUPPRESSING: "suppressing",
  FLUSH_HIM_OUT: "flush_him_out",
  FALL_BACK: "fall_back",
  ADVANCE: "advance",
  HOLD_POSITION: "hold_position",
  
  // Status callouts
  IN_POSITION: "in_position",
  MOVING: "moving",
  NEED_BACKUP: "need_backup",
  LOW_AMMO: "low_ammo",
  WOUNDED: "wounded",
};

/** Default bark cooldowns (ms) */
const BARK_COOLDOWNS = {
  [BARK_TYPE.ENEMY_SPOTTED]: 5000,
  [BARK_TYPE.TAKING_FIRE]: 3000,
  [BARK_TYPE.RELOADING]: 2000,
  [BARK_TYPE.FLANKING]: 8000,
  [BARK_TYPE.COVERING_FIRE]: 4000,
  default: 2000,
};

// ============================================================================
// SQUAD MANAGEMENT
// ============================================================================

/**
 * Create a squad manager
 * @returns {Object} Squad manager
 */
export function createSquadManager() {
  return {
    squads: new Map(),
    npcToSquad: new Map(),
    nextSquadId: 1,
    proximityThreshold: 15, // Max distance to form/join squad
    minSquadSize: 2,
    maxSquadSize: 6,
  };
}

/**
 * Create a new squad
 * @param {Object} manager - Squad manager
 * @param {Object} leader - Leader NPC
 * @returns {Object} New squad
 */
export function createSquad(manager, leader) {
  const squad = {
    id: manager.nextSquadId++,
    members: new Map(),
    leaderId: leader.id,
    targetId: null,
    targetPosition: null,
    formation: "spread",
    state: "idle", // idle, engaging, flanking, retreating
    lastBarkTimes: new Map(),
    pendingBarks: [],
    attackPositions: new Map(), // Track assigned attack positions
  };
  
  squad.members.set(leader.id, {
    npc: leader,
    role: SQUAD_ROLE.LEADER,
    assignedPosition: null,
  });
  
  manager.squads.set(squad.id, squad);
  manager.npcToSquad.set(leader.id, squad.id);
  
  return squad;
}

/**
 * Add NPC to squad
 * @param {Object} manager - Squad manager
 * @param {Object} squad - Squad
 * @param {Object} npc - NPC to add
 * @param {number} role - Squad role
 */
export function addToSquad(manager, squad, npc, role = SQUAD_ROLE.NONE) {
  if (squad.members.size >= manager.maxSquadSize) return false;
  if (manager.npcToSquad.has(npc.id)) return false;
  
  squad.members.set(npc.id, {
    npc,
    role,
    assignedPosition: null,
  });
  
  manager.npcToSquad.set(npc.id, squad.id);
  return true;
}

/**
 * Remove NPC from their squad
 * @param {Object} manager - Squad manager
 * @param {number} npcId - NPC ID
 */
export function removeFromSquad(manager, npcId) {
  const squadId = manager.npcToSquad.get(npcId);
  if (!squadId) return;
  
  const squad = manager.squads.get(squadId);
  if (!squad) return;
  
  squad.members.delete(npcId);
  squad.attackPositions.delete(npcId);
  manager.npcToSquad.delete(npcId);
  
  // Disband if too small
  if (squad.members.size < manager.minSquadSize) {
    disbandSquad(manager, squad);
    return;
  }
  
  // Reassign leader if needed
  if (squad.leaderId === npcId) {
    const firstMember = squad.members.values().next().value;
    if (firstMember) {
      squad.leaderId = firstMember.npc.id;
      firstMember.role = SQUAD_ROLE.LEADER;
    }
  }
}

/**
 * Disband a squad
 * @param {Object} manager - Squad manager
 * @param {Object} squad - Squad to disband
 */
export function disbandSquad(manager, squad) {
  for (const [npcId] of squad.members) {
    manager.npcToSquad.delete(npcId);
  }
  manager.squads.delete(squad.id);
}

/**
 * Update squad formations based on proximity
 * NPCs within range form impromptu squads
 * @param {Object} manager - Squad manager
 * @param {Array<Object>} npcs - All NPCs
 */
export function updateSquadFormations(manager, npcs) {
  // Find NPCs without squads
  const unassigned = npcs.filter((npc) => !manager.npcToSquad.has(npc.id) && !npc.isDead);
  
  for (const npc of unassigned) {
    // Check proximity to existing squads
    let nearestSquad = null;
    let nearestDist = manager.proximityThreshold;
    
    for (const [, squad] of manager.squads) {
      if (squad.members.size >= manager.maxSquadSize) continue;
      
      // Check distance to any squad member
      for (const [, member] of squad.members) {
        const dist = distance(npc.position, member.npc.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSquad = squad;
        }
      }
    }
    
    if (nearestSquad) {
      addToSquad(manager, nearestSquad, npc);
    } else {
      // Check if we can form a new squad with another unassigned NPC
      for (const other of unassigned) {
        if (other.id === npc.id) continue;
        if (manager.npcToSquad.has(other.id)) continue;
        
        const dist = distance(npc.position, other.position);
        if (dist < manager.proximityThreshold) {
          const squad = createSquad(manager, npc);
          addToSquad(manager, squad, other);
          break;
        }
      }
    }
  }
  
  // Clean up squads with dead/removed members
  for (const [, squad] of manager.squads) {
    for (const [npcId, member] of squad.members) {
      if (member.npc.isDead) {
        removeFromSquad(manager, npcId);
      }
    }
  }
}

// ============================================================================
// COORDINATED TACTICS
// ============================================================================

/**
 * Assign tactical roles to squad members
 * @param {Object} squad - Squad
 * @param {number[]} threatPos - Threat position
 */
export function assignSquadRoles(squad, threatPos) {
  if (squad.members.size < 2) return;
  
  const members = Array.from(squad.members.values());
  
  // Leader stays as leader
  const leader = members.find((m) => m.npc.id === squad.leaderId);
  if (leader) leader.role = SQUAD_ROLE.LEADER;
  
  // Sort others by angle to threat
  const others = members.filter((m) => m.npc.id !== squad.leaderId);
  
  if (others.length === 0) return;
  
  // Calculate center of squad
  let centerX = 0, centerZ = 0;
  for (const member of members) {
    centerX += member.npc.position[0];
    centerZ += member.npc.position[2];
  }
  centerX /= members.length;
  centerZ /= members.length;
  
  // Assign roles based on position relative to threat
  const toThreat = vec3Normalize(vec3Sub(threatPos, [centerX, 0, centerZ]));
  const perpLeft = [-toThreat[2], 0, toThreat[0]];
  
  for (const member of others) {
    const toMember = vec3Sub(member.npc.position, [centerX, 0, centerZ]);
    const leftDot = vec3Dot(toMember, perpLeft);
    
    if (leftDot > 2) {
      member.role = SQUAD_ROLE.FLANKER_LEFT;
    } else if (leftDot < -2) {
      member.role = SQUAD_ROLE.FLANKER_RIGHT;
    } else {
      member.role = SQUAD_ROLE.SUPPRESSOR;
    }
  }
}

/**
 * Calculate attack positions for coordinated assault
 * @param {Object} squad - Squad
 * @param {number[]} targetPos - Target position
 * @param {Array<Object>} coverPoints - Available cover
 * @returns {Map<number, number[]>} NPC ID → attack position
 */
export function calculateAttackPositions(squad, targetPos, coverPoints) {
  const positions = new Map();
  const usedCovers = new Set();
  
  for (const [npcId, member] of squad.members) {
    let bestPos = null;
    let bestScore = -Infinity;
    
    // Find cover point based on role
    for (const cover of coverPoints) {
      if (cover.occupiedBy !== null || usedCovers.has(cover)) continue;
      
      const dist = distance(cover.position, targetPos);
      let roleScore = 0;
      
      switch (member.role) {
        case SQUAD_ROLE.LEADER:
          // Leader takes center position
          roleScore = dist > 10 && dist < 20 ? 1 : 0;
          break;
          
        case SQUAD_ROLE.FLANKER_LEFT:
        case SQUAD_ROLE.FLANKER_RIGHT:
          // Flankers want side angles
          const toTarget = vec3Normalize(vec3Sub(targetPos, cover.position));
          const flankDir = member.role === SQUAD_ROLE.FLANKER_LEFT ? [-1, 0, 0] : [1, 0, 0];
          const flankDot = Math.abs(vec3Dot(toTarget, flankDir));
          roleScore = flankDot > 0.5 ? 1 : 0;
          break;
          
        case SQUAD_ROLE.SUPPRESSOR:
          // Suppressor wants clear LOS, medium range
          roleScore = dist > 15 && dist < 30 ? 1 : 0;
          break;
      }
      
      const score = roleScore - dist * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestPos = cover;
      }
    }
    
    if (bestPos) {
      positions.set(npcId, bestPos.position);
      usedCovers.add(bestPos);
      member.assignedPosition = [...bestPos.position];
    }
  }
  
  squad.attackPositions = positions;
  return positions;
}

/**
 * Check if squad should coordinate suppression fire
 * @param {Object} squad - Squad
 * @param {number[]} targetPos - Target position
 * @returns {Object|null} {suppressor, movers} or null
 */
export function planSuppressionManeuver(squad, targetPos) {
  if (squad.members.size < 2) return null;
  
  // Find best suppressor (closest to target with clear LOS)
  const suppressors = Array.from(squad.members.values())
    .filter((m) => m.role === SQUAD_ROLE.SUPPRESSOR || m.role === SQUAD_ROLE.LEADER);
  
  if (suppressors.length === 0) return null;
  
  const movers = Array.from(squad.members.values())
    .filter((m) => m.role === SQUAD_ROLE.FLANKER_LEFT || m.role === SQUAD_ROLE.FLANKER_RIGHT);
  
  if (movers.length === 0) return null;
  
  return {
    suppressors: suppressors.map((s) => s.npc.id),
    movers: movers.map((m) => m.npc.id),
  };
}

// ============================================================================
// COMMUNICATION BARKS
// ============================================================================

/**
 * Queue a bark for the squad
 * @param {Object} squad - Squad
 * @param {number} npcId - Speaking NPC ID
 * @param {string} barkType - BARK_TYPE
 * @param {Object} data - Additional bark data
 */
export function queueBark(squad, npcId, barkType, data = {}) {
  const now = performance.now();
  const cooldown = BARK_COOLDOWNS[barkType] || BARK_COOLDOWNS.default;
  const lastTime = squad.lastBarkTimes.get(barkType) || 0;
  
  if (now - lastTime < cooldown) return;
  
  squad.pendingBarks.push({
    npcId,
    type: barkType,
    data,
    time: now,
  });
  
  squad.lastBarkTimes.set(barkType, now);
}

/**
 * Process pending barks
 * @param {Object} squad - Squad
 * @returns {Array<Object>} Barks to display/play
 */
export function processBarkQueue(squad) {
  const barks = [...squad.pendingBarks];
  squad.pendingBarks = [];
  return barks;
}

/**
 * Get bark text for a bark type
 * @param {string} barkType - BARK_TYPE
 * @returns {string} Bark text
 */
export function getBarkText(barkType) {
  const texts = {
    [BARK_TYPE.ENEMY_SPOTTED]: "Contact!",
    [BARK_TYPE.ENEMY_DOWN]: "Target down!",
    [BARK_TYPE.TAKING_FIRE]: "Taking fire!",
    [BARK_TYPE.RELOADING]: "Reloading!",
    [BARK_TYPE.GRENADE_OUT]: "Grenade out!",
    [BARK_TYPE.GRENADE_INCOMING]: "Grenade!",
    [BARK_TYPE.FLANKING]: "Flanking!",
    [BARK_TYPE.COVERING_FIRE]: "Covering fire!",
    [BARK_TYPE.SUPPRESSING]: "Suppressing!",
    [BARK_TYPE.FLUSH_HIM_OUT]: "Flush him out!",
    [BARK_TYPE.FALL_BACK]: "Fall back!",
    [BARK_TYPE.ADVANCE]: "Move up!",
    [BARK_TYPE.HOLD_POSITION]: "Hold position!",
    [BARK_TYPE.IN_POSITION]: "In position!",
    [BARK_TYPE.MOVING]: "Moving!",
    [BARK_TYPE.NEED_BACKUP]: "Need backup!",
    [BARK_TYPE.LOW_AMMO]: "Low ammo!",
    [BARK_TYPE.WOUNDED]: "I'm hit!",
  };
  
  return texts[barkType] || barkType;
}

// ============================================================================
// SQUAD UPDATES
// ============================================================================

/**
 * Update squad tactical state
 * @param {Object} manager - Squad manager
 * @param {Object} squad - Squad
 * @param {number[]} threatPos - Threat position (if known)
 * @param {Object} options - Update options
 */
export function updateSquadTactics(manager, squad, threatPos, options = {}) {
  if (!threatPos) {
    squad.state = "idle";
    return;
  }
  
  squad.targetPosition = [...threatPos];
  
  // Calculate squad health
  let totalHealth = 0;
  let maxHealth = 0;
  let membersInCover = 0;
  
  for (const [, member] of squad.members) {
    totalHealth += member.npc.health || 0;
    maxHealth += member.npc.maxHealth || 100;
    if (member.npc.coverState?.inCover) membersInCover++;
  }
  
  const healthPercent = maxHealth > 0 ? totalHealth / maxHealth : 0;
  const coverPercent = squad.members.size > 0 ? membersInCover / squad.members.size : 0;
  
  // Decide squad state
  if (healthPercent < 0.3) {
    squad.state = "retreating";
    queueBark(squad, squad.leaderId, BARK_TYPE.FALL_BACK);
  } else if (coverPercent > 0.7 && squad.members.size >= 3) {
    squad.state = "flanking";
  } else {
    squad.state = "engaging";
  }
  
  // Assign roles based on current state
  assignSquadRoles(squad, threatPos);
}

/**
 * Get squad for an NPC
 * @param {Object} manager - Squad manager
 * @param {number} npcId - NPC ID
 * @returns {Object|null} Squad or null
 */
export function getSquadForNPC(manager, npcId) {
  const squadId = manager.npcToSquad.get(npcId);
  if (!squadId) return null;
  return manager.squads.get(squadId) || null;
}

/**
 * Get teammates for an NPC (excluding self)
 * @param {Object} manager - Squad manager
 * @param {number} npcId - NPC ID
 * @returns {Array<Object>} Teammate NPCs
 */
export function getTeammates(manager, npcId) {
  const squad = getSquadForNPC(manager, npcId);
  if (!squad) return [];
  
  const teammates = [];
  for (const [id, member] of squad.members) {
    if (id !== npcId) {
      teammates.push(member.npc);
    }
  }
  return teammates;
}
