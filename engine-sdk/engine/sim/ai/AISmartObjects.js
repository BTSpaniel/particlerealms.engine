// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AISmartObjects.js - Smart Objects System
 * 
 * Objects carry their own interaction logic (like The Sims):
 * - Prerequisites for interaction
 * - Animation/action definitions
 * - Interaction positions and orientations
 * - Effects on agent state
 */

import { vec3Sub, vec3Length, vec3Normalize } from "../../core/math/EngineMath.js";

// ============================================================================
// SMART OBJECT TYPES
// ============================================================================

/** Smart object categories */
export const OBJECT_CATEGORY = {
  COVER: "cover",
  DOOR: "door",
  SWITCH: "switch",
  PICKUP: "pickup",
  SEAT: "seat",
  WEAPON_RACK: "weapon_rack",
  AMMO_CRATE: "ammo_crate",
  HEALTH_STATION: "health_station",
  TURRET: "turret",
  ALARM: "alarm",
  INTEREST: "interest", // Points of interest for patrol/look
};

/** Interaction states */
export const INTERACTION_STATE = {
  IDLE: 0,
  APPROACHING: 1,
  ALIGNING: 2,
  INTERACTING: 3,
  COMPLETE: 4,
};

// ============================================================================
// SMART OBJECT
// ============================================================================

/**
 * Create a smart object
 * @param {Object} config - Object configuration
 * @returns {Object} Smart object
 */
export function createSmartObject(config) {
  return {
    id: config.id,
    name: config.name || "SmartObject",
    category: config.category || OBJECT_CATEGORY.INTEREST,
    
    // World position
    position: config.position ? [...config.position] : [0, 0, 0],
    rotation: config.rotation ?? 0, // Y rotation in radians
    
    // Interaction slots (where NPCs stand to interact)
    slots: config.slots || [{ 
      offset: [0, 0, 1], // Local offset from object
      facing: [0, 0, -1], // Direction to face
      occupied: false,
      occupiedBy: null,
    }],
    
    // Prerequisites
    prerequisites: config.prerequisites || [], // [{type, value}]
    
    // Actions this object provides
    actions: config.actions || [],
    
    // Effects when used
    effects: config.effects || [], // [{stat, delta}]
    
    // Timing
    interactionDuration: config.interactionDuration ?? 1000, // ms
    cooldown: config.cooldown ?? 0,
    lastUsedTime: 0,
    
    // State
    enabled: config.enabled ?? true,
    oneTimeUse: config.oneTimeUse ?? false,
    used: false,
    
    // Animation
    animationName: config.animationName || "use",
    
    // Tags for filtering
    tags: config.tags || [],
  };
}

/**
 * Get world position of an interaction slot
 * @param {Object} smartObject - Smart object
 * @param {number} slotIndex - Slot index
 * @returns {{position: number[], facing: number[]}} World position and facing
 */
export function getSlotWorldPosition(smartObject, slotIndex = 0) {
  const slot = smartObject.slots[slotIndex];
  if (!slot) return null;
  
  // Rotate offset by object rotation
  const cos = Math.cos(smartObject.rotation);
  const sin = Math.sin(smartObject.rotation);
  
  const rotatedOffset = [
    slot.offset[0] * cos - slot.offset[2] * sin,
    slot.offset[1],
    slot.offset[0] * sin + slot.offset[2] * cos,
  ];
  
  const rotatedFacing = [
    slot.facing[0] * cos - slot.facing[2] * sin,
    slot.facing[1],
    slot.facing[0] * sin + slot.facing[2] * cos,
  ];
  
  return {
    position: [
      smartObject.position[0] + rotatedOffset[0],
      smartObject.position[1] + rotatedOffset[1],
      smartObject.position[2] + rotatedOffset[2],
    ],
    facing: rotatedFacing,
  };
}

/**
 * Find available slot for interaction
 * @param {Object} smartObject - Smart object
 * @returns {number} Slot index or -1 if none available
 */
export function findAvailableSlot(smartObject) {
  for (let i = 0; i < smartObject.slots.length; i++) {
    if (!smartObject.slots[i].occupied) {
      return i;
    }
  }
  return -1;
}

/**
 * Reserve a slot for an NPC
 * @param {Object} smartObject - Smart object
 * @param {number} slotIndex - Slot index
 * @param {number} npcId - NPC ID
 * @returns {boolean} True if reserved
 */
export function reserveSlot(smartObject, slotIndex, npcId) {
  const slot = smartObject.slots[slotIndex];
  if (!slot || slot.occupied) return false;
  
  slot.occupied = true;
  slot.occupiedBy = npcId;
  return true;
}

/**
 * Release a slot
 * @param {Object} smartObject - Smart object
 * @param {number} slotIndex - Slot index
 */
export function releaseSlot(smartObject, slotIndex) {
  const slot = smartObject.slots[slotIndex];
  if (!slot) return;
  
  slot.occupied = false;
  slot.occupiedBy = null;
}

// ============================================================================
// PREREQUISITES
// ============================================================================

/**
 * Check if NPC meets prerequisites for interaction
 * @param {Object} smartObject - Smart object
 * @param {Object} npcState - NPC state data
 * @returns {{canUse: boolean, missing: Array}} Can use and missing prereqs
 */
export function checkPrerequisites(smartObject, npcState) {
  if (!smartObject.enabled) {
    return { canUse: false, missing: ["disabled"] };
  }
  
  if (smartObject.oneTimeUse && smartObject.used) {
    return { canUse: false, missing: ["already_used"] };
  }
  
  const now = performance.now();
  if (smartObject.cooldown > 0 && now - smartObject.lastUsedTime < smartObject.cooldown) {
    return { canUse: false, missing: ["cooldown"] };
  }
  
  const missing = [];
  
  for (const prereq of smartObject.prerequisites) {
    switch (prereq.type) {
      case "has_item":
        if (!npcState.inventory?.includes(prereq.value)) {
          missing.push(`needs_${prereq.value}`);
        }
        break;
        
      case "min_health":
        if ((npcState.health || 0) < prereq.value) {
          missing.push("health_too_low");
        }
        break;
        
      case "max_health":
        if ((npcState.health || 0) > prereq.value) {
          missing.push("health_too_high");
        }
        break;
        
      case "team":
        if (npcState.team !== prereq.value) {
          missing.push("wrong_team");
        }
        break;
        
      case "has_weapon":
        if (!npcState.hasWeapon) {
          missing.push("needs_weapon");
        }
        break;
        
      case "custom":
        if (prereq.check && !prereq.check(npcState)) {
          missing.push(prereq.name || "custom_check");
        }
        break;
    }
  }
  
  return { canUse: missing.length === 0, missing };
}

// ============================================================================
// INTERACTION
// ============================================================================

/**
 * Create an interaction session
 * @param {Object} smartObject - Smart object
 * @param {number} npcId - NPC ID
 * @param {number} slotIndex - Reserved slot index
 * @returns {Object} Interaction session
 */
export function createInteraction(smartObject, npcId, slotIndex) {
  const slotWorld = getSlotWorldPosition(smartObject, slotIndex);
  
  return {
    objectId: smartObject.id,
    npcId,
    slotIndex,
    state: INTERACTION_STATE.APPROACHING,
    targetPosition: slotWorld.position,
    targetFacing: slotWorld.facing,
    startTime: 0,
    duration: smartObject.interactionDuration,
  };
}

/**
 * Update interaction state
 * @param {Object} interaction - Interaction session
 * @param {number[]} npcPos - NPC position
 * @param {number[]} npcFacing - NPC facing
 * @param {number} now - Current time
 * @returns {{state: number, progress: number, complete: boolean}}
 */
export function updateInteraction(interaction, npcPos, npcFacing, now) {
  const arrivalRadius = 0.5;
  const alignmentThreshold = 0.9; // Dot product threshold
  
  switch (interaction.state) {
    case INTERACTION_STATE.APPROACHING: {
      const dist = vec3Length(vec3Sub(npcPos, interaction.targetPosition));
      if (dist < arrivalRadius) {
        interaction.state = INTERACTION_STATE.ALIGNING;
      }
      return { state: interaction.state, progress: 0, complete: false };
    }
    
    case INTERACTION_STATE.ALIGNING: {
      const dot = vec3Normalize(npcFacing)[0] * interaction.targetFacing[0] +
                  vec3Normalize(npcFacing)[2] * interaction.targetFacing[2];
      if (dot >= alignmentThreshold) {
        interaction.state = INTERACTION_STATE.INTERACTING;
        interaction.startTime = now;
      }
      return { state: interaction.state, progress: 0, complete: false };
    }
    
    case INTERACTION_STATE.INTERACTING: {
      const elapsed = now - interaction.startTime;
      const progress = Math.min(1, elapsed / interaction.duration);
      
      if (progress >= 1) {
        interaction.state = INTERACTION_STATE.COMPLETE;
        return { state: interaction.state, progress: 1, complete: true };
      }
      return { state: interaction.state, progress, complete: false };
    }
    
    case INTERACTION_STATE.COMPLETE:
      return { state: interaction.state, progress: 1, complete: true };
    
    default:
      return { state: interaction.state, progress: 0, complete: false };
  }
}

/**
 * Complete interaction and apply effects
 * @param {Object} smartObject - Smart object
 * @param {Object} interaction - Interaction session
 * @param {Object} npcState - NPC state to modify
 * @returns {Array} Applied effects
 */
export function completeInteraction(smartObject, interaction, npcState) {
  const appliedEffects = [];
  
  // Apply effects
  for (const effect of smartObject.effects) {
    switch (effect.stat) {
      case "health":
        npcState.health = Math.min(
          npcState.maxHealth || 100,
          (npcState.health || 0) + effect.delta
        );
        appliedEffects.push({ stat: "health", delta: effect.delta });
        break;
        
      case "ammo":
        npcState.ammo = (npcState.ammo || 0) + effect.delta;
        appliedEffects.push({ stat: "ammo", delta: effect.delta });
        break;
        
      case "add_item":
        npcState.inventory = npcState.inventory || [];
        npcState.inventory.push(effect.value);
        appliedEffects.push({ stat: "add_item", value: effect.value });
        break;
        
      case "remove_item":
        if (npcState.inventory) {
          const idx = npcState.inventory.indexOf(effect.value);
          if (idx >= 0) npcState.inventory.splice(idx, 1);
        }
        appliedEffects.push({ stat: "remove_item", value: effect.value });
        break;
        
      case "custom":
        if (effect.apply) {
          effect.apply(npcState);
          appliedEffects.push({ stat: "custom", name: effect.name });
        }
        break;
    }
  }
  
  // Update object state
  smartObject.lastUsedTime = performance.now();
  if (smartObject.oneTimeUse) {
    smartObject.used = true;
    smartObject.enabled = false;
  }
  
  // Release slot
  releaseSlot(smartObject, interaction.slotIndex);
  
  return appliedEffects;
}

// ============================================================================
// SMART OBJECT REGISTRY
// ============================================================================

/**
 * Create a smart object registry
 * @returns {Object} Registry
 */
export function createSmartObjectRegistry() {
  return {
    objects: new Map(),
    byCategory: new Map(),
    byTag: new Map(),
  };
}

/**
 * Register a smart object
 * @param {Object} registry - Registry
 * @param {Object} smartObject - Smart object
 */
export function registerSmartObject(registry, smartObject) {
  registry.objects.set(smartObject.id, smartObject);
  
  // Index by category
  if (!registry.byCategory.has(smartObject.category)) {
    registry.byCategory.set(smartObject.category, []);
  }
  registry.byCategory.get(smartObject.category).push(smartObject);
  
  // Index by tags
  for (const tag of smartObject.tags) {
    if (!registry.byTag.has(tag)) {
      registry.byTag.set(tag, []);
    }
    registry.byTag.get(tag).push(smartObject);
  }
}

/**
 * Find smart objects by category
 * @param {Object} registry - Registry
 * @param {string} category - Category
 * @returns {Array<Object>} Matching objects
 */
export function findByCategory(registry, category) {
  return registry.byCategory.get(category) || [];
}

/**
 * Find smart objects by tag
 * @param {Object} registry - Registry
 * @param {string} tag - Tag
 * @returns {Array<Object>} Matching objects
 */
export function findByTag(registry, tag) {
  return registry.byTag.get(tag) || [];
}

/**
 * Find nearest usable smart object
 * @param {Object} registry - Registry
 * @param {number[]} position - NPC position
 * @param {Object} npcState - NPC state
 * @param {Object} filters - Filters {category, tag, maxDistance}
 * @returns {Object|null} Nearest usable object
 */
export function findNearestUsable(registry, position, npcState, filters = {}) {
  let candidates = [];
  
  if (filters.category) {
    candidates = findByCategory(registry, filters.category);
  } else if (filters.tag) {
    candidates = findByTag(registry, filters.tag);
  } else {
    candidates = Array.from(registry.objects.values());
  }
  
  const maxDist = filters.maxDistance ?? Infinity;
  let nearest = null;
  let nearestDist = Infinity;
  
  for (const obj of candidates) {
    // Check prerequisites
    const { canUse } = checkPrerequisites(obj, npcState);
    if (!canUse) continue;
    
    // Check for available slot
    if (findAvailableSlot(obj) < 0) continue;
    
    // Check distance
    const dist = vec3Length(vec3Sub(obj.position, position));
    if (dist > maxDist) continue;
    
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = obj;
    }
  }
  
  return nearest;
}

// ============================================================================
// PRESET SMART OBJECTS
// ============================================================================

/**
 * Create a health station smart object
 * @param {number} id - Object ID
 * @param {number[]} position - World position
 * @param {number} healAmount - Amount to heal
 * @returns {Object} Smart object
 */
export function createHealthStation(id, position, healAmount = 50) {
  return createSmartObject({
    id,
    name: "Health Station",
    category: OBJECT_CATEGORY.HEALTH_STATION,
    position,
    slots: [{ offset: [0, 0, 1.5], facing: [0, 0, -1], occupied: false }],
    prerequisites: [{ type: "max_health", value: 99 }], // Can't use at full health
    effects: [{ stat: "health", delta: healAmount }],
    interactionDuration: 2000,
    cooldown: 30000,
    tags: ["medical", "usable"],
  });
}

/**
 * Create an ammo crate smart object
 * @param {number} id - Object ID
 * @param {number[]} position - World position
 * @param {number} ammoAmount - Amount of ammo
 * @returns {Object} Smart object
 */
export function createAmmoCrate(id, position, ammoAmount = 30) {
  return createSmartObject({
    id,
    name: "Ammo Crate",
    category: OBJECT_CATEGORY.AMMO_CRATE,
    position,
    slots: [{ offset: [0, 0, 1], facing: [0, 0, -1], occupied: false }],
    prerequisites: [{ type: "has_weapon", value: true }],
    effects: [{ stat: "ammo", delta: ammoAmount }],
    interactionDuration: 1500,
    oneTimeUse: true,
    tags: ["ammo", "usable"],
  });
}

/**
 * Create a door smart object
 * @param {number} id - Object ID
 * @param {number[]} position - World position
 * @param {number} rotation - Y rotation
 * @returns {Object} Smart object
 */
export function createDoor(id, position, rotation = 0) {
  return createSmartObject({
    id,
    name: "Door",
    category: OBJECT_CATEGORY.DOOR,
    position,
    rotation,
    slots: [
      { offset: [0, 0, 1.5], facing: [0, 0, -1], occupied: false },
      { offset: [0, 0, -1.5], facing: [0, 0, 1], occupied: false },
    ],
    prerequisites: [],
    effects: [],
    interactionDuration: 500,
    animationName: "open_door",
    tags: ["door", "navigation"],
  });
}
