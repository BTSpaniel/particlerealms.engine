// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleReactionTable.js - Cross-Emitter Particle Reaction System
 * 
 * GPU-driven reaction table: when particles with different materialIdx collide,
 * the collision shader scans this table for a matching (matA, matB) rule.
 * If found: apply energy, optionally kill reactants, emit reaction event (type 5).
 * EventSpawn reads the rule index to spawn product particles with correct properties.
 * 
 * Exceeds Niagara/PopcornFX/Unity VFX Graph — none support particle-particle reactions.
 * 
 * Usage:
 *   const table = createReactionTable(device);
 *   addReaction(table, MATERIAL.FIRE, MATERIAL.WATER, { ... });
 *   registerDefaultReactions(table);
 *   // Bind table.buffer to sim shader group
 */

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// MATERIAL ID CONSTANTS
// ============================================================================
// These map to the lower 8 bits of thermalData.z (materialIdx) set at spawn time.
// 0 = unassigned (no reactions), 1-255 = substance types.

export const MATERIAL = {
  NONE:     0,
  // Indices 1-10 match thermal MATERIAL_INDEX (LUT order)
  WATER:    1,   // thermal: water (boil 373K)
  ICE:      2,   // thermal: ice
  METAL:    3,   // thermal: metal
  WOOD:     4,   // thermal: wood
  WAX:      5,   // thermal: wax
  LAVA:     6,   // thermal: lava
  OIL:      7,   // thermal: oil
  GLASS:    8,   // thermal: glass
  STONE:    9,   // thermal: stone
  PLASMA:   10,  // thermal: plasma
  // Indices 11-15: reaction-identity materials (own thermal presets)
  FIRE:     11,  // heat source, no phase transitions
  SMOKE:    12,  // low conductivity gas
  STEAM:    13,  // gas-phase water
  SPARKS:   14,  // hot metal fragments
  DEBRIS:   15,  // solid fragments
};

// Reverse lookup for debug logging
const MATERIAL_NAMES = {};
for (const [k, v] of Object.entries(MATERIAL)) {
  MATERIAL_NAMES[v] = k;
}

// Map substance preset keys → material IDs
// Includes legacy preset names, element symbols, and compound keys
export const SUBSTANCE_TO_MATERIAL = {
  // Preset names
  fire:         MATERIAL.FIRE,
  water:        MATERIAL.WATER,
  smoke:        MATERIAL.SMOKE,
  lava:         MATERIAL.LAVA,
  steam:        MATERIAL.STEAM,
  ice:          MATERIAL.ICE,
  snow:         MATERIAL.ICE,     // snow → ice thermal
  plasma:       MATERIAL.PLASMA,
  magic:        MATERIAL.PLASMA,  // magic → plasma thermal
  sparks:       MATERIAL.SPARKS,
  metal_sparks: MATERIAL.SPARKS,
  debris:       MATERIAL.DEBRIS,
  explosion:    MATERIAL.FIRE,
  candle:       MATERIAL.FIRE,
  starfire:     MATERIAL.PLASMA,
  fountain:     MATERIAL.WATER,
  bubbles:      MATERIAL.WATER,
  toxic_gas:    MATERIAL.SMOKE,
  molten_gold:  MATERIAL.LAVA,
  salt:         MATERIAL.DEBRIS,
  // Element symbols (from EMITTER_PRESETS substance field)
  H2O:          MATERIAL.WATER,
  Si:           MATERIAL.LAVA,
  Fe:           MATERIAL.METAL,   // iron → metal thermal
  He:           MATERIAL.PLASMA,
  Au:           MATERIAL.LAVA,
  N:            MATERIAL.SMOKE,
  O:            MATERIAL.WATER,
  C:            MATERIAL.FIRE,
  Na:           MATERIAL.DEBRIS,
  NaCl:         MATERIAL.DEBRIS,
  SiO2:         MATERIAL.DEBRIS,
};

// ============================================================================
// REACTION RULE FLAGS
// ============================================================================

export const REACTION_KILL_A       = 1;  // Kill reactant A on reaction
export const REACTION_KILL_B       = 2;  // Kill reactant B on reaction
export const REACTION_SPAWN_PRODUCT = 4; // Spawn product particles via event system
export const REACTION_KILL_BOTH    = REACTION_KILL_A | REACTION_KILL_B;

// ============================================================================
// GPU STRUCT LAYOUT
// ============================================================================
// Each ReactionRule in GPU uniform buffer:
//   vec4<u32>: matA, matB, productMat, spawnCount          (16 bytes)
//   vec4<f32>: productColor.rgb, energyRelease             (16 bytes)
//   vec4<f32>: productTemp, productSize, productLifetime, flags  (16 bytes)
// Total: 48 bytes per rule, padded to 48 bytes (already 16-aligned)

const RULE_SIZE_BYTES = 48;
const MAX_REACTIONS = 32;
// Buffer: 16 bytes header (reactionCount + padding) + 32 rules × 48 bytes = 1552 bytes → round to 1552
const HEADER_SIZE_BYTES = 16;
const BUFFER_SIZE = HEADER_SIZE_BYTES + MAX_REACTIONS * RULE_SIZE_BYTES;

// ============================================================================
// CREATE / DESTROY
// ============================================================================

/**
 * Create a reaction table with GPU uniform buffer.
 * @param {GPUDevice} device
 * @returns {Object} Reaction table instance
 */
export function createReactionTable(device) {
  const buffer = createUniformBuffer(device, BUFFER_SIZE, { label: 'ReactionTable.buffer' });
  labelResource(buffer, 'ReactionTable.buffer');

  const table = {
    device,
    buffer,
    rules: [],          // Array of reaction rule objects
    _dirty: true,       // Needs GPU upload
    _cpuBuffer: new ArrayBuffer(BUFFER_SIZE),
    _u32View: null,
    _f32View: null,
  };

  table._u32View = new Uint32Array(table._cpuBuffer);
  table._f32View = new Float32Array(table._cpuBuffer);

  return table;
}

/**
 * Destroy the reaction table and release GPU resources.
 */
export function destroyReactionTable(table) {
  if (!table) return;
  if (table.buffer) table.buffer.destroy();
  table.buffer = null;
  table.rules = [];
  table.device = null;
}

// ============================================================================
// ADD / REMOVE REACTIONS
// ============================================================================

/**
 * Add a reaction rule to the table.
 * @param {Object} table - Reaction table
 * @param {number} matA - Material ID of reactant A
 * @param {number} matB - Material ID of reactant B
 * @param {Object} config - Reaction configuration:
 *   {
 *     productMat: MATERIAL.STEAM,       // Material ID of product (for spawned particles)
 *     spawnCount: 4,                     // Number of product particles to spawn (1-16)
 *     productColor: [0.8, 0.8, 0.9],    // RGB color of product particles
 *     energyRelease: 100,               // Temperature change applied to surviving reactants (Kelvin)
 *     productTemp: 373,                 // Temperature of spawned product (Kelvin)
 *     productSize: 0.3,                 // Size of product particles
 *     productLifetime: 1.5,             // Lifetime of product particles (seconds)
 *     flags: REACTION_KILL_BOTH | REACTION_SPAWN_PRODUCT,
 *   }
 * @returns {number} Rule index, or -1 if table is full
 */
export function addReaction(table, matA, matB, config = {}) {
  if (!table || table.rules.length >= MAX_REACTIONS) {
    console.warn('[ReactionTable] Table full, max', MAX_REACTIONS, 'reactions');
    return -1;
  }

  // Prevent duplicate rules
  const existing = table.rules.findIndex(r =>
    (r.matA === matA && r.matB === matB) ||
    (r.matA === matB && r.matB === matA)
  );
  if (existing >= 0) {
    console.warn(`[ReactionTable] Replacing existing reaction ${MATERIAL_NAMES[matA] || matA} + ${MATERIAL_NAMES[matB] || matB}`);
    table.rules[existing] = buildRule(matA, matB, config);
    table._dirty = true;
    return existing;
  }

  const rule = buildRule(matA, matB, config);
  const idx = table.rules.length;
  table.rules.push(rule);
  table._dirty = true;

  console.log(`[ReactionTable] Added reaction #${idx}: ${MATERIAL_NAMES[matA] || matA} + ${MATERIAL_NAMES[matB] || matB} → ${MATERIAL_NAMES[rule.productMat] || rule.productMat} (spawn ${rule.spawnCount}, energy ${rule.energyRelease}K)`);
  return idx;
}

function buildRule(matA, matB, config) {
  return {
    matA,
    matB,
    productMat:      config.productMat ?? 0,
    spawnCount:      Math.min(16, Math.max(0, config.spawnCount ?? 4)),
    productColor:    config.productColor ?? [1, 1, 1],
    energyRelease:   config.energyRelease ?? 0,
    productTemp:     config.productTemp ?? 293,
    productSize:     config.productSize ?? 0.3,
    productLifetime: config.productLifetime ?? 1.0,
    flags:           config.flags ?? (REACTION_KILL_BOTH | REACTION_SPAWN_PRODUCT),
  };
}

/**
 * Remove a reaction rule by index.
 */
export function removeReaction(table, index) {
  if (!table || index < 0 || index >= table.rules.length) return;
  table.rules.splice(index, 1);
  table._dirty = true;
}

/**
 * Remove all reaction rules.
 */
export function clearReactions(table) {
  if (!table) return;
  table.rules.length = 0;
  table._dirty = true;
}

// ============================================================================
// GPU UPLOAD
// ============================================================================

/**
 * Upload the reaction table to the GPU uniform buffer.
 * Call once after adding/removing reactions (not every frame).
 */
export function uploadReactionTable(table) {
  if (!table || !table._dirty || !table.device || !table.buffer) return;

  const u32 = table._u32View;
  const f32 = table._f32View;

  // Zero the buffer
  u32.fill(0);

  // Header: reactionCount at offset 0
  u32[0] = table.rules.length;

  // Rules start at byte offset 16 (after header)
  for (let i = 0; i < table.rules.length; i++) {
    const r = table.rules[i];
    const baseU32 = (HEADER_SIZE_BYTES + i * RULE_SIZE_BYTES) >> 2; // divide by 4 for u32 index

    // vec4<u32>: matA, matB, productMat, spawnCount
    u32[baseU32 + 0] = r.matA;
    u32[baseU32 + 1] = r.matB;
    u32[baseU32 + 2] = r.productMat;
    u32[baseU32 + 3] = r.spawnCount;

    // vec4<f32>: productColor.rgb, energyRelease
    f32[baseU32 + 4] = r.productColor[0];
    f32[baseU32 + 5] = r.productColor[1];
    f32[baseU32 + 6] = r.productColor[2];
    f32[baseU32 + 7] = r.energyRelease;

    // vec4<f32>: productTemp, productSize, productLifetime, flags (u32 via u32 view)
    f32[baseU32 + 8]  = r.productTemp;
    f32[baseU32 + 9]  = r.productSize;
    f32[baseU32 + 10] = r.productLifetime;
    u32[baseU32 + 11] = r.flags; // u32 in WGSL — must use u32 view
  }

  table.device.queue.writeBuffer(table.buffer, 0, new Uint8Array(table._cpuBuffer));
  table._dirty = false;
}

// ============================================================================
// DEFAULT REACTION PRESETS
// ============================================================================

/**
 * Register built-in reaction presets.
 * @param {Object} table - Reaction table
 */
export function registerDefaultReactions(table) {
  if (!table) return;

  // Fire + Water → Steam
  addReaction(table, MATERIAL.FIRE, MATERIAL.WATER, {
    productMat: MATERIAL.STEAM,
    spawnCount: 6,
    productColor: [0.85, 0.85, 0.92],
    energyRelease: 50,
    productTemp: 373,
    productSize: 0.4,
    productLifetime: 2.0,
    flags: REACTION_KILL_BOTH | REACTION_SPAWN_PRODUCT,
  });

  // Fire + Ice → Water
  addReaction(table, MATERIAL.FIRE, MATERIAL.ICE, {
    productMat: MATERIAL.WATER,
    spawnCount: 4,
    productColor: [0.3, 0.5, 0.9],
    energyRelease: -30,
    productTemp: 280,
    productSize: 0.2,
    productLifetime: 1.5,
    flags: REACTION_KILL_BOTH | REACTION_SPAWN_PRODUCT,
  });

  // Lava + Water → Obsidian debris
  addReaction(table, MATERIAL.LAVA, MATERIAL.WATER, {
    productMat: MATERIAL.DEBRIS,
    spawnCount: 8,
    productColor: [0.15, 0.12, 0.18],
    energyRelease: 200,
    productTemp: 800,
    productSize: 0.15,
    productLifetime: 3.0,
    flags: REACTION_KILL_BOTH | REACTION_SPAWN_PRODUCT,
  });

  // Plasma + Water → Steam (big burst)
  addReaction(table, MATERIAL.PLASMA, MATERIAL.WATER, {
    productMat: MATERIAL.STEAM,
    spawnCount: 10,
    productColor: [0.9, 0.9, 1.0],
    energyRelease: 150,
    productTemp: 500,
    productSize: 0.5,
    productLifetime: 2.5,
    flags: REACTION_KILL_B | REACTION_SPAWN_PRODUCT,
  });

  // Fire + Smoke → Ignition (boost smoke temp, small sparks)
  addReaction(table, MATERIAL.FIRE, MATERIAL.SMOKE, {
    productMat: MATERIAL.SPARKS,
    spawnCount: 3,
    productColor: [1.0, 0.6, 0.2],
    energyRelease: 100,
    productTemp: 900,
    productSize: 0.08,
    productLifetime: 0.4,
    flags: REACTION_SPAWN_PRODUCT, // Don't kill either
  });

  // Water + Lava → same as Lava + Water (already covered by symmetric matching)

  // Plasma + Fire → Arcane sparks
  addReaction(table, MATERIAL.PLASMA, MATERIAL.FIRE, {
    productMat: MATERIAL.SPARKS,
    spawnCount: 8,
    productColor: [0.6, 0.2, 1.0],
    energyRelease: 50,
    productTemp: 600,
    productSize: 0.1,
    productLifetime: 0.8,
    flags: REACTION_SPAWN_PRODUCT,
  });

  // Plasma + Water → Steam (covered by rule #3, skipping duplicate)
  // Plasma + Ice → Water (frost melt)
  addReaction(table, MATERIAL.PLASMA, MATERIAL.ICE, {
    productMat: MATERIAL.WATER,
    spawnCount: 5,
    productColor: [0.3, 0.5, 0.9],
    energyRelease: 80,
    productTemp: 300,
    productSize: 0.15,
    productLifetime: 1.5,
    flags: REACTION_KILL_B | REACTION_SPAWN_PRODUCT,
  });

  uploadReactionTable(table);
  console.log(`[ReactionTable] Registered ${table.rules.length} default reactions`);
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the current reaction rules.
 */
export function getReactions(table) {
  return table?.rules || [];
}

/**
 * Get a material name from its ID.
 */
export function getMaterialName(matId) {
  return MATERIAL_NAMES[matId] || `Material(${matId})`;
}

/**
 * Look up the material ID for a substance preset key.
 * @param {string} substanceKey - e.g. 'fire', 'water', 'lava'
 * @returns {number} Material ID (0 if not found)
 */
export function getMaterialForSubstance(substanceKey) {
  if (!substanceKey) return MATERIAL.NONE;
  return SUBSTANCE_TO_MATERIAL[substanceKey] ?? MATERIAL.NONE;
}
