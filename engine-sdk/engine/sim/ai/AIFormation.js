// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIFormation.js - Military Formations and Group Movement
 * 
 * Features:
 * - Formation patterns (line, column, wedge, circle, etc.)
 * - Formation management and transitions
 * - Group pathfinding integration
 * - Leader-follower dynamics
 */

import {
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Length,
  vec3Normalize,
  vec3Cross,
} from "../../core/math/EngineMath.js";

// ============================================================================
// FORMATION TYPES
// ============================================================================

/** Formation patterns */
export const FORMATION_TYPE = {
  NONE: "none",
  LINE: "line",           // Side by side
  COLUMN: "column",       // Single file
  WEDGE: "wedge",         // V-shape, leader at front
  VEE: "vee",             // Inverted V, leader at back
  SQUARE: "square",       // Box formation
  CIRCLE: "circle",       // Surrounding center
  ECHELON_LEFT: "echelon_left",   // Diagonal left
  ECHELON_RIGHT: "echelon_right", // Diagonal right
  STAGGERED: "staggered", // Zigzag
  SKIRMISH: "skirmish",   // Loose spread
};

// ============================================================================
// FORMATION DEFINITION
// ============================================================================

/**
 * Create formation definition
 * @param {string} type - Formation type
 * @param {Object} options - Formation options
 * @returns {Object} Formation definition
 */
export function createFormation(type, options = {}) {
  return {
    type,
    spacing: options.spacing ?? 2,        // Distance between units
    rowSpacing: options.rowSpacing ?? 2,  // Distance between rows
    maxPerRow: options.maxPerRow ?? 10,   // Max units per row
    facing: options.facing ?? [0, 0, 1],  // Formation facing direction
    center: options.center ?? [0, 0, 0],  // Formation center
    
    // Leader position in formation
    leaderPosition: options.leaderPosition ?? "front", // front, center, back
    
    // Slots
    slots: [],
    
    // Active units
    units: new Map(), // unitId → slotIndex
  };
}

/**
 * Generate formation slot positions
 * @param {Object} formation - Formation
 * @param {number} unitCount - Number of units
 * @returns {Array<{offset: number[], priority: number}>} Slot definitions
 */
export function generateFormationSlots(formation, unitCount) {
  const slots = [];
  const { spacing, rowSpacing, maxPerRow } = formation;
  
  switch (formation.type) {
    case FORMATION_TYPE.LINE:
      generateLineSlots(slots, unitCount, spacing);
      break;
      
    case FORMATION_TYPE.COLUMN:
      generateColumnSlots(slots, unitCount, rowSpacing);
      break;
      
    case FORMATION_TYPE.WEDGE:
      generateWedgeSlots(slots, unitCount, spacing, rowSpacing);
      break;
      
    case FORMATION_TYPE.VEE:
      generateVeeSlots(slots, unitCount, spacing, rowSpacing);
      break;
      
    case FORMATION_TYPE.SQUARE:
      generateSquareSlots(slots, unitCount, spacing, rowSpacing);
      break;
      
    case FORMATION_TYPE.CIRCLE:
      generateCircleSlots(slots, unitCount, spacing);
      break;
      
    case FORMATION_TYPE.ECHELON_LEFT:
      generateEchelonSlots(slots, unitCount, spacing, rowSpacing, -1);
      break;
      
    case FORMATION_TYPE.ECHELON_RIGHT:
      generateEchelonSlots(slots, unitCount, spacing, rowSpacing, 1);
      break;
      
    case FORMATION_TYPE.STAGGERED:
      generateStaggeredSlots(slots, unitCount, spacing, rowSpacing, maxPerRow);
      break;
      
    case FORMATION_TYPE.SKIRMISH:
      generateSkirmishSlots(slots, unitCount, spacing);
      break;
      
    default:
      // Default to loose cluster
      generateSkirmishSlots(slots, unitCount, spacing);
  }
  
  formation.slots = slots;
  return slots;
}

// Formation generators
function generateLineSlots(slots, count, spacing) {
  const halfWidth = ((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    slots.push({
      offset: [i * spacing - halfWidth, 0, 0],
      priority: Math.abs(i - Math.floor(count / 2)), // Center slots higher priority
    });
  }
}

function generateColumnSlots(slots, count, spacing) {
  for (let i = 0; i < count; i++) {
    slots.push({
      offset: [0, 0, -i * spacing],
      priority: i, // Front slots higher priority
    });
  }
}

function generateWedgeSlots(slots, count, spacing, rowSpacing) {
  // Leader at front
  slots.push({ offset: [0, 0, 0], priority: 0 });
  
  let remaining = count - 1;
  let row = 1;
  
  while (remaining > 0) {
    const rowCount = Math.min(remaining, row * 2);
    for (let i = 0; i < rowCount; i++) {
      const x = (i - (rowCount - 1) / 2) * spacing;
      const z = -row * rowSpacing;
      slots.push({ offset: [x, 0, z], priority: row });
    }
    remaining -= rowCount;
    row++;
  }
}

function generateVeeSlots(slots, count, spacing, rowSpacing) {
  // Generate wedge then flip Z
  generateWedgeSlots(slots, count, spacing, rowSpacing);
  for (const slot of slots) {
    slot.offset[2] = -slot.offset[2];
  }
}

function generateSquareSlots(slots, count, spacing, rowSpacing) {
  const side = Math.ceil(Math.sqrt(count));
  const halfWidth = ((side - 1) * spacing) / 2;
  const halfDepth = ((Math.ceil(count / side) - 1) * rowSpacing) / 2;
  
  let idx = 0;
  for (let row = 0; row < Math.ceil(count / side) && idx < count; row++) {
    for (let col = 0; col < side && idx < count; col++) {
      slots.push({
        offset: [col * spacing - halfWidth, 0, row * rowSpacing - halfDepth],
        priority: Math.abs(row - Math.floor(Math.ceil(count / side) / 2)),
      });
      idx++;
    }
  }
}

function generateCircleSlots(slots, count, spacing) {
  const radius = (count * spacing) / (2 * Math.PI);
  
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    slots.push({
      offset: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      priority: 0,
    });
  }
}

function generateEchelonSlots(slots, count, spacing, rowSpacing, direction) {
  for (let i = 0; i < count; i++) {
    slots.push({
      offset: [i * spacing * direction, 0, -i * rowSpacing],
      priority: i,
    });
  }
}

function generateStaggeredSlots(slots, count, spacing, rowSpacing, maxPerRow) {
  let idx = 0;
  let row = 0;
  
  while (idx < count) {
    const rowCount = Math.min(count - idx, maxPerRow);
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    const halfWidth = ((rowCount - 1) * spacing) / 2;
    
    for (let col = 0; col < rowCount; col++) {
      slots.push({
        offset: [col * spacing - halfWidth + offset, 0, -row * rowSpacing],
        priority: row,
      });
      idx++;
    }
    row++;
  }
}

function generateSkirmishSlots(slots, count, spacing) {
  const radius = Math.sqrt(count) * spacing;
  
  for (let i = 0; i < count; i++) {
    // Pseudo-random but deterministic positions
    const angle = i * 2.39996323; // Golden angle
    const r = Math.sqrt(i / count) * radius;
    
    slots.push({
      offset: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
      priority: i,
    });
  }
}

// ============================================================================
// FORMATION MANAGER
// ============================================================================

/**
 * Create formation manager for a group
 * @param {Object} formation - Formation definition
 * @returns {Object} Formation manager
 */
export function createFormationManager(formation) {
  return {
    formation,
    leaderId: null,
    
    // Movement
    targetCenter: null,
    targetFacing: null,
    isMoving: false,
    moveSpeed: 5,
    
    // State
    isFormed: false,
    transitionProgress: 0,
    transitionDuration: 2000, // ms to form up
  };
}

/**
 * Assign unit to formation slot
 * @param {Object} manager - Formation manager
 * @param {number} unitId - Unit ID
 * @param {boolean} isLeader - Is this the leader
 * @returns {number} Assigned slot index
 */
export function assignToFormation(manager, unitId, isLeader = false) {
  const { formation } = manager;
  
  // Find unoccupied slot with best priority
  let bestSlot = -1;
  let bestPriority = Infinity;
  
  for (let i = 0; i < formation.slots.length; i++) {
    if (!Array.from(formation.units.values()).includes(i)) {
      if (formation.slots[i].priority < bestPriority) {
        bestPriority = formation.slots[i].priority;
        bestSlot = i;
      }
    }
  }
  
  if (bestSlot >= 0) {
    formation.units.set(unitId, bestSlot);
    
    if (isLeader) {
      manager.leaderId = unitId;
    }
  }
  
  return bestSlot;
}

/**
 * Remove unit from formation
 * @param {Object} manager - Formation manager
 * @param {number} unitId - Unit ID
 */
export function removeFromFormation(manager, unitId) {
  manager.formation.units.delete(unitId);
  
  if (manager.leaderId === unitId) {
    // Assign new leader
    const remaining = Array.from(manager.formation.units.keys());
    manager.leaderId = remaining.length > 0 ? remaining[0] : null;
  }
}

/**
 * Get unit's target position in formation
 * @param {Object} manager - Formation manager
 * @param {number} unitId - Unit ID
 * @returns {number[]|null} World position
 */
export function getFormationPosition(manager, unitId) {
  const { formation } = manager;
  const slotIdx = formation.units.get(unitId);
  
  if (slotIdx === undefined || !formation.slots[slotIdx]) {
    return null;
  }
  
  const slot = formation.slots[slotIdx];
  
  // Transform slot offset by formation facing
  const facing = vec3Normalize(formation.facing);
  const right = vec3Normalize(vec3Cross(facing, [0, 1, 0]));
  const up = [0, 1, 0];
  
  const worldOffset = vec3Add(
    vec3Add(
      vec3Scale(right, slot.offset[0]),
      vec3Scale(up, slot.offset[1])
    ),
    vec3Scale(facing, slot.offset[2])
  );
  
  return vec3Add(formation.center, worldOffset);
}

/**
 * Move formation to target
 * @param {Object} manager - Formation manager
 * @param {number[]} targetCenter - Target center position
 * @param {number[]} targetFacing - Target facing direction (optional)
 */
export function moveFormation(manager, targetCenter, targetFacing = null) {
  manager.targetCenter = [...targetCenter];
  manager.targetFacing = targetFacing ? [...targetFacing] : null;
  manager.isMoving = true;
}

/**
 * Update formation movement
 * @param {Object} manager - Formation manager
 * @param {number} deltaTime - Delta time in seconds
 * @returns {boolean} Formation reached destination
 */
export function updateFormationMovement(manager, deltaTime) {
  if (!manager.isMoving || !manager.targetCenter) {
    return true;
  }
  
  const { formation } = manager;
  const toTarget = vec3Sub(manager.targetCenter, formation.center);
  const dist = vec3Length(toTarget);
  
  const moveAmount = manager.moveSpeed * deltaTime;
  
  if (dist <= moveAmount) {
    formation.center = [...manager.targetCenter];
    
    if (manager.targetFacing) {
      formation.facing = vec3Normalize(manager.targetFacing);
    }
    
    manager.isMoving = false;
    return true;
  }
  
  // Move toward target
  const moveDir = vec3Scale(toTarget, 1 / dist);
  formation.center = vec3Add(formation.center, vec3Scale(moveDir, moveAmount));
  
  // Rotate facing toward target
  if (manager.targetFacing) {
    const currentFacing = formation.facing;
    const targetFacing = vec3Normalize(manager.targetFacing);
    const t = Math.min(1, deltaTime * 2);
    
    formation.facing = vec3Normalize([
      currentFacing[0] + (targetFacing[0] - currentFacing[0]) * t,
      currentFacing[1] + (targetFacing[1] - currentFacing[1]) * t,
      currentFacing[2] + (targetFacing[2] - currentFacing[2]) * t,
    ]);
  }
  
  return false;
}

/**
 * Change formation type
 * @param {Object} manager - Formation manager
 * @param {string} newType - New formation type
 * @param {Object} options - Formation options
 */
export function changeFormation(manager, newType, options = {}) {
  const unitIds = Array.from(manager.formation.units.keys());
  
  manager.formation.type = newType;
  manager.formation.spacing = options.spacing ?? manager.formation.spacing;
  manager.formation.rowSpacing = options.rowSpacing ?? manager.formation.rowSpacing;
  
  // Regenerate slots
  generateFormationSlots(manager.formation, Math.max(unitIds.length, 1));
  
  // Clear unit assignments
  manager.formation.units.clear();
  
  // Reassign units
  for (const unitId of unitIds) {
    assignToFormation(manager, unitId, unitId === manager.leaderId);
  }
  
  manager.isFormed = false;
  manager.transitionProgress = 0;
}

/**
 * Get all unit target positions
 * @param {Object} manager - Formation manager
 * @returns {Map<number, number[]>} Unit ID → target position
 */
export function getAllFormationPositions(manager) {
  const positions = new Map();
  
  for (const [unitId] of manager.formation.units) {
    const pos = getFormationPosition(manager, unitId);
    if (pos) {
      positions.set(unitId, pos);
    }
  }
  
  return positions;
}

/**
 * Check if formation is formed up
 * @param {Object} manager - Formation manager
 * @param {Map<number, number[]>} currentPositions - Current unit positions
 * @param {number} threshold - Distance threshold
 * @returns {boolean} Is formed up
 */
export function isFormationComplete(manager, currentPositions, threshold = 1) {
  for (const [unitId, current] of currentPositions) {
    const target = getFormationPosition(manager, unitId);
    if (!target) continue;
    
    const dist = vec3Length(vec3Sub(current, target));
    if (dist > threshold) {
      return false;
    }
  }
  
  manager.isFormed = true;
  return true;
}

// ============================================================================
// PRESET FORMATIONS
// ============================================================================

/**
 * Create preset formations for common scenarios
 */
export const PRESET_FORMATIONS = {
  infantry_line: () => createFormation(FORMATION_TYPE.LINE, { spacing: 1.5 }),
  cavalry_wedge: () => createFormation(FORMATION_TYPE.WEDGE, { spacing: 3, rowSpacing: 3 }),
  archer_skirmish: () => createFormation(FORMATION_TYPE.SKIRMISH, { spacing: 4 }),
  defensive_circle: () => createFormation(FORMATION_TYPE.CIRCLE, { spacing: 2 }),
  march_column: () => createFormation(FORMATION_TYPE.COLUMN, { rowSpacing: 1.5 }),
  testudo: () => createFormation(FORMATION_TYPE.SQUARE, { spacing: 0.8, rowSpacing: 0.8 }),
};
