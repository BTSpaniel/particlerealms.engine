// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeParticleInteraction.js — CPU-side per-tick bridge between free particles and ropes.
 *
 * Runs each simulation frame and performs:
 *  1. Spatial proximity query: find free particles near each rope node
 *  2. Heat transfer: fire/lava/plasma → rope heats up; ice/snow → rope cools
 *  3. Moisture absorption: water/blood/honey near rope → rope gets heavier, sags
 *  4. Corrosion: acid particles eat away rope integrity
 *  5. Thermal conduction: heat spreads along the rope between adjacent nodes
 *  6. Burning: when node temperature exceeds burn threshold → ignite, char, break
 *  7. Chain splitting: when integrity reaches 0 → break constraint → 2 separate chains
 *
 * Works with ALL materials including steel/chain — metal softens and eventually
 * breaks at high enough temperatures (lava, plasma). Thresholds differ per material.
 *
 * This is a CPU-side system because it needs to:
 *  - Make topology decisions (break constraints, split chains)
 *  - Spawn new emitters (fire/smoke on burning rope)
 *  - Modify per-constraint mass values (moisture → heavier)
 */

import {
  getRopeInteractionMaterial,
  getSubstanceInteraction,
  createRopeNodeState,
  INTERACTION_HEAT,
  INTERACTION_MOISTURE,
  INTERACTION_COOL,
  INTERACTION_CORRODE,
} from './RopeMaterial.js';
import { statsMean } from '../../core/math/MathStatistics.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const INTERACTION_RADIUS     = 1.0;   // World units — max distance for particle↔node interaction
const INTERACTION_RADIUS_SQ  = INTERACTION_RADIUS * INTERACTION_RADIUS;
const AMBIENT_TEMPERATURE    = 293;   // K (room temperature)
const AMBIENT_COOL_RATE      = 0.02;  // How fast rope cools toward ambient per second
const CONDUCTION_ITERATIONS  = 2;     // Per-tick heat spread passes along chain
const MIN_INTEGRITY_TO_BREAK = 0.001; // Below this, constraint is broken

// =============================================================================
// SYSTEM CREATION
// =============================================================================

/**
 * Create the rope↔particle interaction system.
 * Attach to the particle world and call stepRopeInteraction() each tick.
 *
 * @returns {Object} Interaction system state
 */
export function createRopeInteractionSystem() {
  return {
    ropeStates: new Map(),   // entityId → { nodeState, material, ropeRef }
    _dirty: false,
    enabled: true,
  };
}

/**
 * Register a rope for interaction tracking.
 * Call this after createGPURope.
 *
 * @param {Object} system - Interaction system
 * @param {number} entityId - Rope entity ID
 * @param {Object} ropeMetadata - From createGPURope (particleStart, particleCount, etc.)
 * @param {string} fiberMaterial - Material name (hemp, steel, chain, silk, etc.)
 * @param {number} [ambientTemp=293] - Starting temperature
 */
export function registerRopeForInteraction(system, entityId, ropeMetadata, fiberMaterial, ambientTemp = 293) {
  const mat = getRopeInteractionMaterial(fiberMaterial);
  const nodeState = createRopeNodeState(ropeMetadata.particleCount, ambientTemp);

  system.ropeStates.set(entityId, {
    nodeState,
    material: mat,
    fiberMaterial,
    ropeRef: ropeMetadata,
    splitChildren: [],      // Track child ropes from splits
    isBurning: false,       // At least one node is on fire
    burningNodes: 0,
  });
}

/**
 * Unregister a rope (cleanup).
 * @param {Object} system
 * @param {number} entityId
 */
export function unregisterRopeInteraction(system, entityId) {
  system.ropeStates.delete(entityId);
}

// =============================================================================
// MAIN TICK — Call once per simulation frame
// =============================================================================

/**
 * Step the rope↔particle interaction system.
 *
 * @param {Object} system - Interaction system from createRopeInteractionSystem()
 * @param {Object} world - Particle sim world (has ropeChains, position readback, etc.)
 * @param {Float32Array} positionsCPU - CPU-side particle positions (vec4 per particle)
 * @param {Float32Array} thermalCPU - CPU-side thermal data (vec4 per particle: temp, phase, packedGroupMat, latent)
 * @param {Float32Array|null} metaCPU - CPU-side meta buffer (vec4 per particle: r,g,b,packed)
 * @param {number} dt - Time step in seconds
 * @param {Object} [callbacks] - Optional callbacks for spawning effects
 * @param {Function} [callbacks.onNodeIgnited] - (entityId, nodeIndex, position)
 * @param {Function} [callbacks.onNodeBroken] - (entityId, nodeIndex, position)
 * @param {Function} [callbacks.onRopeSplit] - (entityId, nodeIndex, childA, childB)
 * @param {Function} [callbacks.onMassChanged] - (entityId, nodeIndex, newMass)
 */
export function stepRopeInteraction(system, world, positionsCPU, thermalCPU, metaCPU, dt, callbacks = {}) {
  if (!system.enabled || !positionsCPU || !thermalCPU) return;
  if (system.ropeStates.size === 0) return;

  const particleCount = (positionsCPU.length / 4) | 0;

  for (const [entityId, ropeState] of system.ropeStates) {
    const { nodeState, material, ropeRef } = ropeState;
    const { particleStart, particleCount: ropeNodeCount } = ropeRef;

    if (ropeNodeCount <= 0) continue;

    // Reset per-tick counters
    ropeState.burningNodes = 0;

    // ── Phase 1: Gather interactions from nearby free particles ──
    _accumulateParticleInteractions(
      nodeState, material, ropeRef,
      positionsCPU, thermalCPU, metaCPU,
      particleCount, dt
    );

    // ── Phase 2: Thermal conduction along the rope chain ──
    _conductHeatAlongRope(nodeState, material, dt);

    // ── Phase 3: Ambient cooling / drying ──
    _applyAmbientEffects(nodeState, material, dt);

    // ── Phase 4: Evaluate burn/char/break per node ──
    for (let n = 0; n < ropeNodeCount; n++) {
      // Skip already-destroyed nodes
      if (nodeState.integrity[n] <= 0) continue;

      const temp = nodeState.temperature[n];

      // ── Ignition check ──
      if (!nodeState.burning[n] && material.flammability > 0 && temp >= material.burnTemperature) {
        nodeState.burning[n] = 1;
        const pos = _getNodePosition(positionsCPU, particleStart + n);
        callbacks.onNodeIgnited?.(entityId, n, pos);
      }

      // ── Burning progression ──
      if (nodeState.burning[n]) {
        ropeState.burningNodes++;
        // Char accumulates; burning rope also self-heats (exothermic)
        nodeState.charred[n] += material.charRate * dt;
        nodeState.temperature[n] += 50 * material.flammability * dt; // Self-heating
        // Integrity loss from charring
        nodeState.integrity[n] -= material.charRate * dt;
      }

      // ── Metal softening / melting ──
      if (material.meltTemperature > 0 && temp >= material.meltTemperature) {
        // Above melt point: integrity drops proportional to overshoot
        const overshoot = (temp - material.meltTemperature) / material.meltTemperature;
        nodeState.integrity[n] -= overshoot * 0.5 * dt;
      }

      // ── Temperature-based structural failure ──
      if (temp >= material.breakTemperature) {
        nodeState.integrity[n] -= 0.8 * dt; // Fast break at break temp
      }

      // Clamp
      nodeState.integrity[n] = Math.max(0, nodeState.integrity[n]);
      nodeState.charred[n] = Math.min(1, nodeState.charred[n]);

      // ── Chain split when integrity reaches zero ──
      if (nodeState.integrity[n] <= MIN_INTEGRITY_TO_BREAK) {
        const pos = _getNodePosition(positionsCPU, particleStart + n);
        callbacks.onNodeBroken?.(entityId, n, pos);
        _breakRopeAtNode(system, world, entityId, n, callbacks);
        break; // Only one break per tick per rope to avoid cascade issues
      }
    }

    // ── Phase 5: Update constraint masses from moisture ──
    _updateConstraintMasses(world, ropeRef, nodeState, material, callbacks, entityId);

    ropeState.isBurning = ropeState.burningNodes > 0;
  }
}

// =============================================================================
// PHASE 1: PARTICLE PROXIMITY QUERY + ACCUMULATION
// =============================================================================

function _accumulateParticleInteractions(nodeState, material, ropeRef, positionsCPU, thermalCPU, metaCPU, totalParticles, dt) {
  const { particleStart, particleCount: ropeNodeCount } = ropeRef;
  const ropeEnd = particleStart + ropeNodeCount;

  // For each free particle (not part of this rope), check distance to each rope node
  // This is O(freeParticles × ropeNodes) — acceptable for < 5000 particles and < 128 nodes
  // TODO: use spatial grid for better scaling
  for (let pi = 0; pi < totalParticles; pi++) {
    // Skip rope's own particles
    if (pi >= particleStart && pi < ropeEnd) continue;

    const px = positionsCPU[pi * 4];
    const py = positionsCPU[pi * 4 + 1];
    const pz = positionsCPU[pi * 4 + 2];
    const pw = positionsCPU[pi * 4 + 3]; // age in .w

    // Skip dead particles (age stored in positions.w for some setups)
    // We rely on thermalCPU for substance info
    const pTemp = thermalCPU[pi * 4];      // temperature
    const pPhase = thermalCPU[pi * 4 + 1]; // phase (0=solid,1=liquid,2=gas,3=plasma)
    const pPackedMat = thermalCPU[pi * 4 + 2]; // packed: (groupId << 8) | materialIdx

    // Decode material index
    const materialIdx = (pPackedMat | 0) & 0xFF;

    // Map materialIdx to substance key for interaction lookup
    const substance = _materialIdxToSubstance(materialIdx);
    if (!substance) continue;

    const interaction = getSubstanceInteraction(substance);
    if (!interaction) continue;

    // Check against each rope node
    for (let n = 0; n < ropeNodeCount; n++) {
      if (nodeState.integrity[n] <= 0) continue;

      const ni = particleStart + n;
      const nx = positionsCPU[ni * 4];
      const ny = positionsCPU[ni * 4 + 1];
      const nz = positionsCPU[ni * 4 + 2];

      const dx = px - nx;
      const dy = py - ny;
      const dz = pz - nz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > INTERACTION_RADIUS_SQ || distSq < 0.0001) continue;

      // Falloff: stronger interaction when closer
      const dist = Math.sqrt(distSq);
      const falloff = 1.0 - (dist / INTERACTION_RADIUS);
      const strength = falloff * falloff * interaction.intensity * dt;

      switch (interaction.type) {
        case INTERACTION_HEAT: {
          // Transfer heat toward particle temperature
          const heatDelta = (pTemp - nodeState.temperature[n]) * material.thermalConductivity * strength / material.thermalMass;
          nodeState.temperature[n] += heatDelta;
          break;
        }
        case INTERACTION_MOISTURE: {
          if (material.moistureCapacity > 0) {
            const room = material.moistureCapacity - nodeState.moisture[n];
            if (room > 0) {
              const absorbed = Math.min(room, material.moistureRate * strength * interaction.moisture);
              nodeState.moisture[n] += absorbed;
            }
          }
          break;
        }
        case INTERACTION_COOL: {
          const coolDelta = (interaction.temperature - nodeState.temperature[n]) * material.thermalConductivity * strength / material.thermalMass;
          nodeState.temperature[n] += coolDelta; // coolDelta is negative when rope is warmer
          break;
        }
        case INTERACTION_CORRODE: {
          nodeState.integrity[n] -= material.corrosionRate * strength;
          break;
        }
      }
    }
  }
}

// =============================================================================
// PHASE 2: THERMAL CONDUCTION ALONG ROPE
// =============================================================================

function _conductHeatAlongRope(nodeState, material, dt) {
  const n = nodeState.nodeCount;
  if (n < 2) return;

  const conductivity = material.thermalConductivity;
  const thermalMass = material.thermalMass;

  for (let iter = 0; iter < CONDUCTION_ITERATIONS; iter++) {
    for (let i = 0; i < n - 1; i++) {
      const tempA = nodeState.temperature[i];
      const tempB = nodeState.temperature[i + 1];
      const delta = (tempB - tempA) * conductivity * dt / thermalMass;
      nodeState.temperature[i] += delta;
      nodeState.temperature[i + 1] -= delta;
    }
  }
}

// =============================================================================
// PHASE 3: AMBIENT EFFECTS
// =============================================================================

function _applyAmbientEffects(nodeState, material, dt) {
  for (let i = 0; i < nodeState.nodeCount; i++) {
    // Cool toward ambient
    const tempDiff = nodeState.temperature[i] - AMBIENT_TEMPERATURE;
    nodeState.temperature[i] -= tempDiff * AMBIENT_COOL_RATE * dt;

    // Dry naturally
    if (nodeState.moisture[i] > 0) {
      nodeState.moisture[i] = Math.max(0, nodeState.moisture[i] - material.dryRate * dt);
    }

    // Wet rope can't burn (moisture suppresses fire)
    if (nodeState.moisture[i] > 0.3 && nodeState.burning[i]) {
      nodeState.burning[i] = 0;
      // Steam cooling effect
      nodeState.temperature[i] = Math.min(nodeState.temperature[i], 373);
    }

    // Freeze stiffening handled by thermal stiffness modifier in GPU constraint shader
  }
}

// =============================================================================
// PHASE 5: CONSTRAINT MASS UPDATE FROM MOISTURE
// =============================================================================

function _updateConstraintMasses(world, ropeRef, nodeState, material, callbacks, entityId) {
  if (!world || !world.ropeConstraintSystem || !world.device) return;

  const system = world.ropeConstraintSystem;
  const { particleStart, particleCount: nodeCount, constraintStart } = ropeRef;

  // Each distance/rope constraint connects node[i] to node[i+1]
  // We only need to update if moisture has changed
  for (let i = 0; i < nodeCount - 1; i++) {
    const moistureA = nodeState.moisture[i];
    const moistureB = nodeState.moisture[i + 1];
    const avgMoisture = (moistureA + moistureB) * 0.5;

    if (avgMoisture > 0.01) {
      const massMultiplier = 1.0 + (material.wetMassMultiplier - 1.0) * avgMoisture;
      const newMass = material.dryMass * massMultiplier;

      // Update constraint mass fields on GPU
      const constraintIdx = constraintStart + i;
      if (constraintIdx < system.constraintCount) {
        // massA at byte offset 28, massB at byte offset 44
        const massData = new Float32Array([newMass]);
        world.device.queue.writeBuffer(system.constraintBuffer, constraintIdx * 64 + 28, massData);
        world.device.queue.writeBuffer(system.constraintBuffer, constraintIdx * 64 + 44, massData);
      }

      callbacks.onMassChanged?.(entityId, i, newMass);
    }
  }
}

// =============================================================================
// CHAIN SPLITTING
// =============================================================================

function _breakRopeAtNode(system, world, entityId, nodeIndex, callbacks) {
  if (!world) return;

  const ropeState = system.ropeStates.get(entityId);
  if (!ropeState) return;

  const { ropeRef } = ropeState;
  if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= ropeRef.particleCount - 1) return;

  // Use the existing cutRope infrastructure if RopePhysicsSystem is available
  if (world.ropePhysicsSystem) {
    const ropeId = `entity_${entityId}`;
    const result = world.ropePhysicsSystem.cutRope(ropeId, nodeIndex);
    if (result) {
      callbacks.onRopeSplit?.(entityId, nodeIndex, result.ropeA, result.ropeB);
      return;
    }
  }

  // Fallback: mark the constraint as broken via GPU flag
  if (world.ropeConstraintSystem && world.device) {
    const constraintIdx = ropeRef.constraintStart + nodeIndex;
    if (constraintIdx < world.ropeConstraintSystem.constraintCount) {
      // Set FLAG_BROKEN (0x1) in the constraint's flags field (byte offset 60)
      const record = world.ropeConstraintSystem.records?.[constraintIdx];
      if (record) record[15] |= 1;
      const flagsData = new Uint32Array([record?.[15] ?? 0x1]);
      world.device.queue.writeBuffer(
        world.ropeConstraintSystem.constraintBuffer,
        constraintIdx * 64 + 60,
        flagsData
      );
      console.log(`[RopeInteraction] Broke constraint ${constraintIdx} for entity ${entityId} at node ${nodeIndex}`);
    }
  }

  callbacks.onRopeSplit?.(entityId, nodeIndex, null, null);
}

// =============================================================================
// HELPERS
// =============================================================================

function _getNodePosition(positionsCPU, particleIndex) {
  const i = particleIndex * 4;
  return [positionsCPU[i], positionsCPU[i + 1], positionsCPU[i + 2]];
}

/**
 * Map MATERIAL enum index → substance key for interaction lookup.
 * Matches MATERIAL_INDEX from ParticleSimWorld / SubstanceSchema.
 */
function _materialIdxToSubstance(matIdx) {
  switch (matIdx) {
    case 1:  return 'water';
    case 2:  return 'ice';
    case 3:  return 'metal';
    case 4:  return 'wood';   // no rope interaction for wood particles
    case 5:  return 'wax';    // no interaction defined
    case 6:  return 'lava';
    case 7:  return 'oil';
    case 8:  return 'glass';  // no interaction
    case 9:  return 'stone';  // no interaction
    case 10: return 'plasma';
    case 11: return 'fire';
    case 12: return 'smoke';  // no interaction
    case 13: return 'steam';
    case 14: return 'sparks';
    case 15: return 'debris'; // no interaction
    case 16: return 'mercury'; // no interaction defined
    case 17: return 'acid';
    case 18: return 'blood';
    case 19: return 'honey';
    case 20: return 'sand';   // no interaction
    case 21: return 'snow';
    default: return null;
  }
}

// =============================================================================
// QUERY HELPERS — For external systems (rendering, audio, UI)
// =============================================================================

/**
 * Get the current interaction state for a rope.
 * @param {Object} system
 * @param {number} entityId
 * @returns {Object|null} { temperature[], moisture[], integrity[], burning[], isBurning, burningNodes }
 */
export function getRopeInteractionState(system, entityId) {
  const state = system.ropeStates.get(entityId);
  if (!state) return null;
  return {
    temperature: state.nodeState.temperature,
    moisture: state.nodeState.moisture,
    integrity: state.nodeState.integrity,
    burning: state.nodeState.burning,
    charred: state.nodeState.charred,
    isBurning: state.isBurning,
    burningNodes: state.burningNodes,
    material: state.fiberMaterial,
  };
}

/**
 * Get average temperature of a rope.
 * @param {Object} system
 * @param {number} entityId
 * @returns {number} Average temperature in K, or 293 if not found
 */
export function getRopeAverageTemperature(system, entityId) {
  const state = system.ropeStates.get(entityId);
  if (!state) return AMBIENT_TEMPERATURE;
  const temps = state.nodeState.temperature;
  return temps.length === 0 ? Number.NaN : statsMean(temps);
}

/**
 * Get average moisture saturation of a rope.
 * @param {Object} system
 * @param {number} entityId
 * @returns {number} Average moisture 0-1
 */
export function getRopeAverageMoisture(system, entityId) {
  const state = system.ropeStates.get(entityId);
  if (!state) return 0;
  const moist = state.nodeState.moisture;
  return moist.length === 0 ? Number.NaN : statsMean(moist);
}

/**
 * Destroy the interaction system and release all state.
 * @param {Object} system
 */
export function destroyRopeInteractionSystem(system) {
  if (!system) return;
  system.ropeStates.clear();
  system.enabled = false;
}
