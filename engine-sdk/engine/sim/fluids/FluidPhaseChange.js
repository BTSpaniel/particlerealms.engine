// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID PHASE CHANGE - Freeze/Melt mechanics for fluid-rigid transitions
// =============================================================================
// Implements phase transitions between fluid and solid states:
// - Freeze: Extract fluid region → spawn rigid body
// - Melt: Destroy rigid body → inject fluid mass/momentum

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";
import { OGC_WGSL_MODULE, DEFAULT_CONTACT_RADIUS } from '../physics/OGCContact.js';

const freezeSeedStateByDevice = new WeakMap();
const heatSeedStateByDevice = new WeakMap();
const phaseVisualStateByDevice = new WeakMap();

/**
 * Phase states for fluid cells/particles
 */
export const FluidPhase = {
  FLUID: 0,
  FREEZING: 1,  // Transitioning to solid
  FROZEN: 2,    // Solid/rigid
  MELTING: 3,   // Transitioning to fluid
};

/**
 * Particle solidification attributes (per-particle)
 * - temperature: Current temp (ambient ~20, freezing < 0)
 * - magicSaturation: 0-1, how much "freeze magic" has accumulated
 * - solidPhase: 0=fluid, 1=freezing, 2=frozen
 * - seedStrength: If > 0, this particle spreads solidification
 */
export const PARTICLE_PHASE_STRIDE = 4; // floats per particle: temp, magic, phase, seed

/**
 * Crystal bond attributes (per-bond)
 * Stores connections between frozen particles forming crystal lattice
 * - particleA: index of first particle
 * - particleB: index of second particle  
 * - restDistance: original distance when bond formed (constraint target)
 * - stiffness: bond strength (0-1, higher = more rigid)
 */
export const BOND_STRIDE = 4; // floats per bond: particleA (as float), particleB, restDistance, stiffness
export const MAX_BONDS_PER_PARTICLE = 6; // Hexagonal/cubic lattice typically has 6 neighbors

/**
 * Create phase change data structures
 */
export function createPhaseChangeBuffers(device, gridSize, maxParticles) {
  const [gx, gy, gz] = gridSize;
  const cellCount = gx * gy * gz;
  
  // Per-cell phase state
  const cellPhaseBuffer = device.createBuffer({
    label: "PhaseChange.cellPhase",
    size: cellCount * 4, // u32 per cell
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Per-cell temperature (affects phase transitions)
  const temperatureBuffer = device.createBuffer({
    label: "PhaseChange.temperature",
    size: cellCount * 4, // f32 per cell
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Freeze region accumulator (for extracting shapes)
  const freezeRegionBuffer = device.createBuffer({
    label: "PhaseChange.freezeRegion",
    size: cellCount * 4, // f32 density in freeze region
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  
  // Params buffer
  const paramsBuffer = device.createBuffer({
    label: "PhaseChange.params",
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  // Per-particle phase data (temp, magic, phaseEnergy, unused)
  const particlePhaseBuffer = device.createBuffer({
    label: "PhaseChange.particlePhase",
    size: maxParticles * PARTICLE_PHASE_STRIDE * 4, // 4 floats per particle
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Per-particle seed strength (separate for cleaner GPU access)
  const seedBuffer = device.createBuffer({
    label: "PhaseChange.seed",
    size: maxParticles * 4, // 1 float per particle
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Crystal bond buffer - stores particle-particle connections
  // Each bond: [particleA, particleB, restDistance, stiffness]
  const maxBonds = maxParticles * MAX_BONDS_PER_PARTICLE;
  const bondBuffer = device.createBuffer({
    label: "PhaseChange.bonds",
    size: maxBonds * BOND_STRIDE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  
  // Bond count per particle (for constraint solving)
  const bondCountBuffer = device.createBuffer({
    label: "PhaseChange.bondCount",
    size: maxParticles * 4, // u32 per particle
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Active bond count (atomic counter)
  const bondCounterBuffer = device.createBuffer({
    label: "PhaseChange.bondCounter",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  
  return {
    cellPhaseBuffer,
    temperatureBuffer,
    freezeRegionBuffer,
    particlePhaseBuffer,
    seedBuffer,
    paramsBuffer,
    bondBuffer,
    bondCountBuffer,
    bondCounterBuffer,
    cellCount,
    gridSize,
    maxParticles,
    maxBonds,
  };
}

/**
 * Spell force injection point
 */
export function createSpellForce(position, direction, power, element) {
  return {
    position: [...position],
    direction: [...direction],
    power: power || 10.0,
    radius: power ? Math.sqrt(power) * 0.5 : 1.0,
    element: element || "water", // water, fire, ice, magic
  };
}

/**
 * Generate shader for applying spell forces to fluid
 */
export function createSpellForceShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Spell Force Injection
// =============================================================================
// Applies force from spell casts into the fluid velocity field

struct SpellForce {
  posX : f32,
  posY : f32,
  posZ : f32,
  radius : f32,
  dirX : f32,
  dirY : f32,
  dirZ : f32,
  power : f32,
};

struct SpellParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  cellSize : f32,
  worldMinX : f32,
  worldMinY : f32,
  worldMinZ : f32,
  forceCount : f32,
  dt : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var<storage, read_write> velocity : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> density : array<f32>;
@group(0) @binding(2) var<storage, read> forces : array<SpellForce>;
@group(0) @binding(3) var<uniform> params : SpellParams;

fn gridToWorld(gx : f32, gy : f32, gz : f32) -> vec3<f32> {
  return vec3<f32>(
    params.worldMinX + gx * params.cellSize,
    params.worldMinY + gy * params.cellSize,
    params.worldMinZ + gz * params.cellSize
  );
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let gridX = i32(params.gridSizeX);
  let gridY = i32(params.gridSizeY);
  let gridZ = i32(params.gridSizeZ);
  let cellCount = gridX * gridY * gridZ;
  
  let idx = i32(gid.x);
  if (idx >= cellCount) { return; }
  
  // Decode cell coordinates
  let layerSize = gridX * gridY;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gridX;
  let x = rem - y * gridX;
  
  let cellCenter = gridToWorld(f32(x) + 0.5, f32(y) + 0.5, f32(z) + 0.5);
  
  var vel = velocity[u32(idx)].xyz;
  var dens = density[u32(idx)];
  
  let forceCount = i32(params.forceCount);
  
  for (var i = 0; i < forceCount; i++) {
    let force = forces[i];
    let forcePos = vec3<f32>(force.posX, force.posY, force.posZ);
    let forceDir = vec3<f32>(force.dirX, force.dirY, force.dirZ);
    
    let toCell = cellCenter - forcePos;
    let dist = length(toCell);
    
    if (dist < force.radius) {
      // Smooth falloff
      let falloff = 1.0 - (dist / force.radius);
      let strength = falloff * falloff * force.power * params.dt;
      
      // Add force in spell direction
      vel += forceDir * strength;
      
      // Add density (for visual effect)
      dens += falloff * force.power * 0.1 * params.dt;
    }
  }
  
  velocity[u32(idx)] = vec4<f32>(vel, 0.0);
  density[u32(idx)] = dens;
}
`;
}

/**
 * Generate shader for freeze effect (temperature-based phase transition)
 */
export function createFreezeShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Freeze Effect
// =============================================================================
// Lowers temperature in a region, causing phase transition to frozen

struct FreezeParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  cellSize : f32,
  worldMinX : f32,
  worldMinY : f32,
  worldMinZ : f32,
  freezeX : f32,
  freezeY : f32,
  freezeZ : f32,
  freezeRadius : f32,
  freezePower : f32,
  freezeThreshold : f32, // Temperature below which fluid freezes
  dt : f32,
  _pad0 : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var<storage, read_write> temperature : array<f32>;
@group(0) @binding(1) var<storage, read_write> phase : array<u32>;
@group(0) @binding(2) var<storage, read> density : array<f32>;
@group(0) @binding(3) var<storage, read_write> freezeRegion : array<f32>;
@group(0) @binding(4) var<uniform> params : FreezeParams;

const PHASE_FLUID : u32 = 0u;
const PHASE_FREEZING : u32 = 1u;
const PHASE_FROZEN : u32 = 2u;

fn gridToWorld(gx : f32, gy : f32, gz : f32) -> vec3<f32> {
  return vec3<f32>(
    params.worldMinX + gx * params.cellSize,
    params.worldMinY + gy * params.cellSize,
    params.worldMinZ + gz * params.cellSize
  );
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let gridX = i32(params.gridSizeX);
  let gridY = i32(params.gridSizeY);
  let gridZ = i32(params.gridSizeZ);
  let cellCount = gridX * gridY * gridZ;
  
  let idx = i32(gid.x);
  if (idx >= cellCount) { return; }
  
  let layerSize = gridX * gridY;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gridX;
  let x = rem - y * gridX;
  
  let cellCenter = gridToWorld(f32(x) + 0.5, f32(y) + 0.5, f32(z) + 0.5);
  let freezeCenter = vec3<f32>(params.freezeX, params.freezeY, params.freezeZ);
  
  let dist = length(cellCenter - freezeCenter);
  var temp = temperature[u32(idx)];
  var currentPhase = phase[u32(idx)];
  let dens = density[u32(idx)];
  
  // Apply freeze effect
  if (dist < params.freezeRadius) {
    let falloff = 1.0 - (dist / params.freezeRadius);
    let cooling = falloff * falloff * params.freezePower * params.dt;
    temp -= cooling;
    
    // Clamp temperature
    temp = max(temp, -100.0);
  }
  
  // Natural warming toward ambient (20°C)
  let ambient = 20.0;
  temp += (ambient - temp) * 0.01 * params.dt;
  
  // Phase transitions based on temperature
  if (temp < params.freezeThreshold && dens > 0.01) {
    if (currentPhase == PHASE_FLUID) {
      currentPhase = PHASE_FREEZING;
    } else if (currentPhase == PHASE_FREEZING) {
      currentPhase = PHASE_FROZEN;
      // Mark this cell for rigid body extraction
      freezeRegion[u32(idx)] = dens;
    }
  } else if (temp > params.freezeThreshold + 5.0) {
    // Hysteresis for melting
    if (currentPhase == PHASE_FROZEN) {
      currentPhase = PHASE_FLUID;
      freezeRegion[u32(idx)] = 0.0;
    }
  }
  
  temperature[u32(idx)] = temp;
  phase[u32(idx)] = currentPhase;
}
`;
}

/**
 * Generate shader for particle-based crystallization chain reaction
 * Physics-based with latent heat buffer, hysteresis, and asymmetric rates
 * 
 * Key concepts from real physics:
 * - Latent heat: Energy absorbed/released during phase change while temp stays constant
 * - Hysteresis: Different thresholds for freezing vs melting (prevents flickering)
 * - Supercooling: Fluid can stay liquid below freezing until nucleation occurs
 */
export function createCrystallizationShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Particle Crystallization with Latent Heat & Hysteresis
// =============================================================================
// Based on real phase transition physics:
// - Latent heat buffer delays phase transitions
// - Asymmetric rates: fast freeze (magic), slow melt (natural)
// - Hysteresis prevents state flickering

struct CrystalParams {
  particleCount : u32,
  neighborRadius : f32,        // Search radius for chain reaction
  
  // Temperature thresholds (with hysteresis gap)
  freezeThreshold : f32,       // Start freezing below this (default: 0°C)
  meltThreshold : f32,         // Start melting above this (default: 10°C) - higher = longer frozen
  
  // Magic thresholds
  magicFreezeThreshold : f32,  // Magic saturation to trigger freeze (0.5)
  magicDecayRate : f32,        // How fast magic fades when frozen (very slow)
  
  // Latent heat (energy buffer during phase change)
  latentHeatFreeze : f32,      // Energy to remove for full freeze (default: 50)
  latentHeatMelt : f32,        // Energy to add for full melt (default: 100 - 2x slower!)
  
  // Spread rates
  tempSpreadRate : f32,        // Cold spreads to neighbors
  magicSpreadRate : f32,       // Magic spreads to neighbors
  seedBoostFactor : f32,       // How much seeds accelerate freezing
  
  // Timing
  warmingRate : f32,           // Natural warming toward ambient (slow)
  freezeRate : f32,            // Base freeze speed (fast when triggered)
  meltRate : f32,              // Base melt speed (slow - 1/4 of freeze)
  
  dt : f32,
  ambientTemp : f32,
  minClusterSize : u32,        // Minimum particles to form solid (2-3)
  _pad : u32,
};

// Particle positions (read from particle system)
@group(0) @binding(0) var<storage, read> positions : array<vec4<f32>>;

// Per-particle phase data: [temp, magicSaturation, phaseEnergy, phase]
// phaseEnergy: 0 = fully fluid, 1 = fully frozen (latent heat progress)
@group(0) @binding(1) var<storage, read_write> particlePhase : array<vec4<f32>>;

// Seed strengths (separate for cleaner data layout)
@group(0) @binding(2) var<storage, read_write> seedData : array<f32>;

@group(0) @binding(3) var<uniform> params : CrystalParams;

// Phase states encoded in phaseEnergy progress
const PHASE_FLUID : f32 = 0.0;      // phaseEnergy < 0.1
const PHASE_FREEZING : f32 = 1.0;   // 0.1 <= phaseEnergy < 0.9
const PHASE_FROZEN : f32 = 2.0;     // phaseEnergy >= 0.9

fn getPhaseState(phaseEnergy : f32) -> f32 {
  if (phaseEnergy >= 0.9) { return PHASE_FROZEN; }
  if (phaseEnergy >= 0.1) { return PHASE_FREEZING; }
  return PHASE_FLUID;
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let pos = positions[idx].xyz;
  var data = particlePhase[idx];
  var temp = data.x;
  var magic = data.y;
  var phaseEnergy = data.z;  // 0 = liquid, 1 = solid (latent heat progress)
  var phase = getPhaseState(phaseEnergy);
  var seed = seedData[idx];
  
  // Accumulate influence from neighbors
  var coldInfluence = 0.0;
  var magicInfluence = 0.0;
  var solidNeighborCount = 0u;
  var seedInfluence = 0.0;
  
  // Stochastic neighbor sampling - sample ~32 random neighbors instead of all
  // This reduces O(n²) to O(n*k) where k=32
  let sampleCount = min(32u, params.particleCount);
  let stride = max(1u, params.particleCount / sampleCount);
  let offset = idx % stride;  // Offset based on particle index for variety
  
  for (var s = 0u; s < sampleCount; s++) {
    let j = (offset + s * stride) % params.particleCount;
    if (j == idx) { continue; }
    
    let otherPos = positions[j].xyz;
    let dist = length(otherPos - pos);
    
    if (dist < params.neighborRadius && dist > 0.001) {
      let otherData = particlePhase[j];
      let otherTemp = otherData.x;
      let otherMagic = otherData.y;
      let otherPhaseEnergy = otherData.z;
      let otherSeed = seedData[j];
      
      // Distance falloff (quadratic)
      let falloff = 1.0 - (dist / params.neighborRadius);
      let weight = falloff * falloff;
      
      // Cold spreads from colder neighbors
      coldInfluence += (otherTemp - temp) * weight * 0.5;
      
      // Magic spreads from saturated neighbors
      if (otherMagic > magic) {
        magicInfluence += (otherMagic - magic) * weight;
      }
      
      // Solid/freezing neighbors boost crystallization (chain reaction!)
      if (otherPhaseEnergy >= 0.1) {
        solidNeighborCount += 1u;
        
        // Seeds actively accelerate freezing in neighbors
        if (otherSeed > 0.0) {
          seedInfluence += otherSeed * weight * params.seedBoostFactor;
        }
        
        // Contact with frozen particles transfers "freeze energy"
        if (otherPhaseEnergy > phaseEnergy) {
          let energyTransfer = (otherPhaseEnergy - phaseEnergy) * weight * 0.3;
          phaseEnergy += energyTransfer * params.dt;
        }
      }
    }
  }
  
  // Scale up influence to compensate for sampling
  let scaleFactor = f32(params.particleCount) / f32(sampleCount);
  coldInfluence *= scaleFactor * 0.1;  // Reduce to prevent over-influence
  magicInfluence *= scaleFactor * 0.1;
  
  // === TEMPERATURE DYNAMICS ===
  // Apply neighbor temperature influence
  temp += coldInfluence * params.tempSpreadRate * params.dt;
  
  // Natural warming toward ambient (SLOW when frozen due to latent heat)
  let warmingMultiplier = select(1.0, 0.1, phase >= PHASE_FROZEN);
  temp += (params.ambientTemp - temp) * params.warmingRate * warmingMultiplier * params.dt;
  temp = clamp(temp, -100.0, 100.0);
  
  // === MAGIC DYNAMICS ===
  magic += magicInfluence * params.magicSpreadRate * params.dt;
  // Magic decays VERY slowly when frozen (ice retains magical charge)
  let magicDecay = select(params.magicDecayRate, params.magicDecayRate * 0.1, phase >= PHASE_FROZEN);
  magic = max(0.0, magic - magicDecay * params.dt);
  magic = clamp(magic, 0.0, 1.0);
  
  // === PHASE ENERGY (LATENT HEAT) ===
  // Freezing: triggered by cold OR magic, boosted by seeds and neighbors
  let shouldFreeze = (temp < params.freezeThreshold) || (magic > params.magicFreezeThreshold);
  let hasChainBoost = solidNeighborCount >= params.minClusterSize;
  
  if (shouldFreeze && phaseEnergy < 1.0) {
    // Calculate freeze rate (fast, boosted by magic and neighbors)
    var freezeSpeed = params.freezeRate;
    
    // Magic dramatically speeds up freezing
    freezeSpeed *= (1.0 + magic * 3.0);
    
    // More solid neighbors = faster chain crystallization
    freezeSpeed *= (1.0 + f32(solidNeighborCount) * 0.5);
    
    // Seed particles provide massive boost
    freezeSpeed += seedInfluence;
    
    // Colder = faster freezing
    let coldBoost = max(0.0, params.freezeThreshold - temp) * 0.1;
    freezeSpeed *= (1.0 + coldBoost);
    
    // Progress toward frozen (fill latent heat buffer)
    phaseEnergy += (freezeSpeed / params.latentHeatFreeze) * params.dt;
    
    // Newly transitioning particles become weak seeds
    if (phaseEnergy >= 0.1 && seed < 0.2) {
      seed = 0.3;
    }
    // Fully frozen = strong seed briefly
    if (phaseEnergy >= 0.9 && seed < 0.5) {
      seed = 0.8;
    }
  }
  
  // Melting: only when warm AND magic depleted (SLOW!)
  let shouldMelt = (temp > params.meltThreshold) && (magic < 0.1);
  
  if (shouldMelt && phaseEnergy > 0.0) {
    // Melt rate is much slower than freeze rate
    var meltSpeed = params.meltRate;
    
    // Hotter = faster melting (but still slow)
    let heatBoost = max(0.0, temp - params.meltThreshold) * 0.05;
    meltSpeed *= (1.0 + heatBoost);
    
    // Neighbors being frozen slows melting further
    meltSpeed *= max(0.2, 1.0 - f32(solidNeighborCount) * 0.15);
    
    // Progress toward liquid (drain latent heat buffer)
    phaseEnergy -= (meltSpeed / params.latentHeatMelt) * params.dt;
    
    // Lost solid state = lost seed power
    if (phaseEnergy < 0.5) {
      seed *= 0.9;
    }
  }
  
  // Clamp phase energy
  phaseEnergy = clamp(phaseEnergy, 0.0, 1.0);
  
  // Seed decay (slow for frozen, faster for liquid)
  let seedDecayRate = select(0.5, 0.05, phaseEnergy > 0.5);
  seed = max(0.0, seed - seedDecayRate * params.dt);
  
  // Write results
  particlePhase[idx] = vec4<f32>(temp, magic, phaseEnergy, 0.0);
  seedData[idx] = seed;
}
`;
}

/**
 * Default crystallization parameters - tuned for fast freeze, slow melt
 */
export const DEFAULT_CRYSTAL_PARAMS = {
  neighborRadius: 1.5,
  
  // Hysteresis gap: freeze at 0°C, melt at 15°C (must get quite warm to melt)
  freezeThreshold: 0.0,
  meltThreshold: 15.0,
  
  // Magic triggers
  magicFreezeThreshold: 0.5,
  magicDecayRate: 0.02,  // Magic fades slowly
  
  // Latent heat (melt buffer is 2x freeze = ice lasts longer)
  latentHeatFreeze: 50.0,
  latentHeatMelt: 100.0,
  
  // Spread rates
  tempSpreadRate: 2.0,
  magicSpreadRate: 1.5,
  seedBoostFactor: 5.0,  // Seeds are powerful
  
  // Timing (freeze is 4x faster than melt)
  warmingRate: 0.5,
  freezeRate: 4.0,
  meltRate: 1.0,
  
  ambientTemp: 20.0,
  minClusterSize: 2,  // Only 2 particles needed to boost chain reaction
};

/**
 * Default solid collision parameters
 */
export const DEFAULT_SOLID_COLLISION_PARAMS = {
  // Collision radii
  particleRadius: 0.15,        // Physical radius of solid particles
  collisionStiffness: 0.8,     // How rigid collisions are (0-1)
  friction: 0.3,               // Surface friction coefficient
  restitution: 0.1,            // Bounciness (low for ice)
  
  // Temperature transfer on collision
  tempTransferRate: 5.0,       // Heat transfer speed on contact
  contactCoolingBoost: 2.0,    // Frozen particles cool others faster
  
  // Bond formation
  bondFormDistance: 0.4,       // Max distance to form crystal bond
  bondBreakDistance: 0.8,      // Distance at which bonds break
  bondStiffness: 0.95,         // How rigid bonds are (0-1)
  maxBondsPerParticle: 6,      // Hexagonal lattice = 6 neighbors
};

/**
 * Generate shader for solid particle collision
 * Frozen particles get rigid collision with world, entities, AND other particles
 * Also handles temperature transfer on contact
 */
export function createSolidCollisionShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Solid Particle Collision
// =============================================================================
// Frozen particles collide rigidly with everything:
// - World bounds (room)
// - Entity colliders (AABBs)
// - Other particles (both frozen and fluid)
// Also transfers temperature on contact (cold spreads!)

struct CollisionParams {
  particleCount : u32,
  colliderCount : u32,
  particleRadius : f32,
  collisionStiffness : f32,
  
  friction : f32,
  restitution : f32,
  tempTransferRate : f32,
  contactCoolingBoost : f32,
  
  roomMinX : f32, roomMinY : f32, roomMinZ : f32,
  roomMaxX : f32, roomMaxY : f32, roomMaxZ : f32,
  
  dt : f32,
  neighborRadius : f32,
};

// Particle positions: xyz = position, w = age
@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
// Particle velocities: xyz = velocity, w = unused
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
// Per-particle phase data: [temp, magicSaturation, phaseEnergy, unused]
@group(0) @binding(2) var<storage, read_write> particlePhase : array<vec4<f32>>;
// Entity colliders: pairs of vec4 (min, max)
@group(0) @binding(3) var<storage, read> colliders : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params : CollisionParams;

// Phase states
const PHASE_FLUID : f32 = 0.0;
const PHASE_FREEZING : f32 = 1.0;
const PHASE_FROZEN : f32 = 2.0;

fn getPhaseState(phaseEnergy : f32) -> f32 {
  if (phaseEnergy >= 0.9) { return PHASE_FROZEN; }
  if (phaseEnergy >= 0.1) { return PHASE_FREEZING; }
  return PHASE_FLUID;
}

// Sphere-sphere collision response
fn resolveSphereCollision(
  posA : vec3<f32>, velA : vec3<f32>,
  posB : vec3<f32>, velB : vec3<f32>,
  radiusSum : f32, stiffness : f32, friction : f32, restitution : f32
) -> vec4<f32> {
  let delta = posA - posB;
  let dist = length(delta);
  
  if (dist >= radiusSum || dist < 0.001) {
    return vec4<f32>(0.0);
  }
  
  let normal = delta / dist;
  let penetration = radiusSum - dist;
  
  // Position correction (push apart)
  let correction = normal * penetration * stiffness * 0.5;
  
  // Velocity correction (collision response)
  let relVel = velA - velB;
  let normalVel = dot(relVel, normal);
  
  if (normalVel > 0.0) {
    // Already separating
    return vec4<f32>(correction, 0.0);
  }
  
  // Impulse with restitution
  let impulse = -(1.0 + restitution) * normalVel * 0.5;
  let velChange = normal * impulse;
  
  // Tangent friction
  let tangentVel = relVel - normal * normalVel;
  let tangentLen = length(tangentVel);
  var frictionForce = vec3<f32>(0.0);
  if (tangentLen > 0.001) {
    frictionForce = -normalize(tangentVel) * min(tangentLen * friction, abs(impulse) * friction);
  }
  
  return vec4<f32>(correction + velChange + frictionForce, 1.0);
}

// AABB collision for entity colliders
fn resolveAABBCollision(
  pos : vec3<f32>, vel : vec3<f32>, radius : f32,
  aabbMin : vec3<f32>, aabbMax : vec3<f32>,
  friction : f32, restitution : f32
) -> vec4<f32> {
  // Find closest point on AABB
  let closest = clamp(pos, aabbMin, aabbMax);
  let delta = pos - closest;
  let dist = length(delta);
  
  if (dist >= radius || dist < 0.001) {
    // Check if inside AABB
    if (all(pos >= aabbMin) && all(pos <= aabbMax)) {
      // Inside box - push out to nearest face
      let toMin = pos - aabbMin;
      let toMax = aabbMax - pos;
      var minDist = toMin.x;
      var normal = vec3<f32>(-1.0, 0.0, 0.0);
      if (toMax.x < minDist) { minDist = toMax.x; normal = vec3<f32>(1.0, 0.0, 0.0); }
      if (toMin.y < minDist) { minDist = toMin.y; normal = vec3<f32>(0.0, -1.0, 0.0); }
      if (toMax.y < minDist) { minDist = toMax.y; normal = vec3<f32>(0.0, 1.0, 0.0); }
      if (toMin.z < minDist) { minDist = toMin.z; normal = vec3<f32>(0.0, 0.0, -1.0); }
      if (toMax.z < minDist) { minDist = toMax.z; normal = vec3<f32>(0.0, 0.0, 1.0); }
      
      let correction = normal * (minDist + radius);
      let normalVel = dot(vel, normal);
      var velChange = vec3<f32>(0.0);
      if (normalVel < 0.0) {
        velChange = normal * (-normalVel * (1.0 + restitution));
      }
      return vec4<f32>(correction + velChange, 1.0);
    }
    return vec4<f32>(0.0);
  }
  
  let normal = delta / dist;
  let penetration = radius - dist;
  
  let correction = normal * penetration;
  let normalVel = dot(vel, normal);
  
  var velChange = vec3<f32>(0.0);
  if (normalVel < 0.0) {
    velChange = normal * (-normalVel * (1.0 + restitution));
    // Friction on tangent
    let tangentVel = vel - normal * normalVel;
    velChange -= tangentVel * friction;
  }
  
  return vec4<f32>(correction + velChange, 1.0);
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  var pos = positions[idx].xyz;
  let age = positions[idx].w;
  var vel = velocities[idx].xyz;
  var phase = particlePhase[idx];
  let phaseEnergy = phase.z;
  var temp = phase.x;
  
  let isFrozen = phaseEnergy >= 0.5;  // Frozen or freezing
  let radius = params.particleRadius;
  let stiffness = params.collisionStiffness;
  let friction = params.friction;
  let restitution = params.restitution;
  
  // Scale collision response by phase (frozen = rigid, fluid = soft)
  let rigidity = select(0.2, 1.0, isFrozen);
  
  // === WORLD BOUNDS COLLISION ===
  let roomMin = vec3<f32>(params.roomMinX, params.roomMinY, params.roomMinZ);
  let roomMax = vec3<f32>(params.roomMaxX, params.roomMaxY, params.roomMaxZ);
  
  // Floor collision (most important)
  if (pos.y - radius < roomMin.y) {
    pos.y = roomMin.y + radius;
    if (vel.y < 0.0) {
      vel.y = -vel.y * restitution;
      vel.x *= (1.0 - friction);
      vel.z *= (1.0 - friction);
    }
  }
  // Ceiling
  if (pos.y + radius > roomMax.y) {
    pos.y = roomMax.y - radius;
    if (vel.y > 0.0) { vel.y = -vel.y * restitution; }
  }
  // Walls
  if (pos.x - radius < roomMin.x) {
    pos.x = roomMin.x + radius;
    if (vel.x < 0.0) { vel.x = -vel.x * restitution; }
  }
  if (pos.x + radius > roomMax.x) {
    pos.x = roomMax.x - radius;
    if (vel.x > 0.0) { vel.x = -vel.x * restitution; }
  }
  if (pos.z - radius < roomMin.z) {
    pos.z = roomMin.z + radius;
    if (vel.z < 0.0) { vel.z = -vel.z * restitution; }
  }
  if (pos.z + radius > roomMax.z) {
    pos.z = roomMax.z - radius;
    if (vel.z > 0.0) { vel.z = -vel.z * restitution; }
  }
  
  // === ENTITY COLLIDER COLLISION ===
  let colliderCount = i32(params.colliderCount);
  for (var c = 0; c < colliderCount; c++) {
    let aabbMin = colliders[c * 2].xyz;
    let aabbMax = colliders[c * 2 + 1].xyz;
    
    let result = resolveAABBCollision(pos, vel, radius, aabbMin, aabbMax, friction, restitution);
    if (result.w > 0.0) {
      pos += result.xyz * rigidity;
      vel += result.xyz * rigidity;
    }
  }
  
  // === PARTICLE-PARTICLE COLLISION ===
  // Stochastic sampling for performance
  let sampleCount = min(48u, params.particleCount);
  let stride = max(1u, params.particleCount / sampleCount);
  let offset = idx % stride;
  
  var totalTempTransfer = 0.0;
  var contactCount = 0u;
  
  for (var s = 0u; s < sampleCount; s++) {
    let j = (offset + s * stride) % params.particleCount;
    if (j == idx) { continue; }
    
    let otherPos = positions[j].xyz;
    let otherVel = velocities[j].xyz;
    let otherPhase = particlePhase[j];
    let otherPhaseEnergy = otherPhase.z;
    let otherTemp = otherPhase.x;
    let otherFrozen = otherPhaseEnergy >= 0.5;
    
    let dist = length(otherPos - pos);
    let radiusSum = radius * 2.0;
    
    // Collision detection
    if (dist < radiusSum && dist > 0.001) {
      // Both frozen = rigid collision
      // One frozen = semi-rigid (frozen pushes fluid)
      // Both fluid = soft separation (handled elsewhere)
      let collisionRigidity = select(
        0.3,  // Both fluid
        select(0.7, 1.0, isFrozen && otherFrozen),  // One or both frozen
        isFrozen || otherFrozen
      );
      
      if (collisionRigidity > 0.3) {
        let result = resolveSphereCollision(
          pos, vel, otherPos, otherVel,
          radiusSum, stiffness * collisionRigidity, friction, restitution
        );
        pos += result.xyz * params.dt;
        vel += result.xyz;
      }
      
      contactCount++;
      
      // === TEMPERATURE TRANSFER ON CONTACT ===
      // Cold spreads from frozen to fluid particles!
      // Key: Frozen particles RESIST warming but SPREAD cold aggressively
      
      let tempDiff = otherTemp - temp;
      var transferRate = params.tempTransferRate;
      
      // Distance falloff
      let contactFactor = 1.0 - (dist / radiusSum);
      
      if (otherFrozen && !isFrozen) {
        // OTHER is frozen, I am fluid → I get COOLED aggressively
        // Frozen particles actively spread cold to fluid neighbors
        transferRate *= params.contactCoolingBoost * 2.0;  // Double boost for spreading cold
        totalTempTransfer += tempDiff * transferRate * contactFactor * params.dt;
      } else if (isFrozen && !otherFrozen) {
        // I am frozen, OTHER is fluid → I resist warming (latent heat)
        // Only warm up at 10% rate (ice doesn't melt easily from contact)
        transferRate *= 0.1;
        totalTempTransfer += tempDiff * transferRate * contactFactor * params.dt;
      } else if (isFrozen && otherFrozen) {
        // Both frozen → equalize temperature slowly (cold conducts to cold)
        transferRate *= 0.3;
        totalTempTransfer += tempDiff * transferRate * contactFactor * params.dt;
      } else {
        // Both fluid → normal heat exchange
        totalTempTransfer += tempDiff * transferRate * contactFactor * params.dt;
      }
    }
  }
  
  // Scale up temperature transfer to compensate for sampling
  let scaleFactor = f32(params.particleCount) / f32(sampleCount);
  totalTempTransfer *= scaleFactor * 0.1;
  temp += totalTempTransfer;
  temp = clamp(temp, -100.0, 100.0);
  
  // Frozen particles have reduced velocity (ice doesn't flow)
  if (isFrozen) {
    vel *= 0.95;  // Strong damping
  }
  
  // Write back
  positions[idx] = vec4<f32>(pos, age);
  velocities[idx] = vec4<f32>(vel, velocities[idx].w);
  phase.x = temp;
  particlePhase[idx] = phase;
}
`;
}

/**
 * Generate shader for crystal bond formation
 * Finds nearby frozen particles and creates rigid bonds between them
 */
export function createCrystalBondShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Crystal Bond Formation
// =============================================================================
// When frozen particles are close together, create bonds between them
// Bonds store rest distance and keep particles locked in crystal lattice

struct BondParams {
  particleCount : u32,
  bondFormDistance : f32,
  bondBreakDistance : f32,
  bondStiffness : f32,
  maxBondsPerParticle : u32,
  currentBondCount : u32,
  maxBonds : u32,
  _pad : u32,
};

// Bond structure: [particleA (as float), particleB, restDistance, stiffness]
@group(0) @binding(0) var<storage, read> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> particlePhase : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> bonds : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> bondCount : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bondCounter : atomic<u32>;
@group(0) @binding(5) var<uniform> params : BondParams;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let pos = positions[idx].xyz;
  let phase = particlePhase[idx];
  let phaseEnergy = phase.z;
  
  // Only frozen particles can form bonds
  if (phaseEnergy < 0.9) { return; }
  
  // Check current bond count for this particle
  let myBondCount = atomicLoad(&bondCount[idx]);
  if (myBondCount >= params.maxBondsPerParticle) { return; }
  
  // Stochastic neighbor sampling
  let sampleCount = min(32u, params.particleCount);
  let stride = max(1u, params.particleCount / sampleCount);
  
  for (var s = 0u; s < sampleCount; s++) {
    let j = (idx + s * stride + 1u) % params.particleCount;
    if (j == idx || j < idx) { continue; }  // Only process pairs once (j > idx)
    
    let otherPhase = particlePhase[j];
    let otherPhaseEnergy = otherPhase.z;
    
    // Other particle must also be frozen
    if (otherPhaseEnergy < 0.9) { continue; }
    
    let otherPos = positions[j].xyz;
    let dist = length(otherPos - pos);
    
    // Within bonding distance?
    if (dist < params.bondFormDistance && dist > 0.01) {
      // Check if other particle can accept more bonds
      let otherBondCount = atomicLoad(&bondCount[j]);
      if (otherBondCount >= params.maxBondsPerParticle) { continue; }
      
      // Try to allocate a bond slot
      let bondIdx = atomicAdd(&bondCounter, 1u);
      if (bondIdx >= params.maxBonds) {
        atomicSub(&bondCounter, 1u);
        return;
      }
      
      // Increment bond counts
      atomicAdd(&bondCount[idx], 1u);
      atomicAdd(&bondCount[j], 1u);
      
      // Store bond: [particleA, particleB, restDistance, stiffness]
      bonds[bondIdx] = vec4<f32>(
        f32(idx),
        f32(j),
        dist,  // Rest distance = current distance when bond forms
        params.bondStiffness
      );
    }
  }
}
`;
}

/**
 * Generate shader for bond constraint solving (Position-Based Dynamics)
 * Maintains rigid crystal structure by keeping bonded particles at fixed distances
 */
export function createBondConstraintShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Bond Constraint Solver (Position-Based Dynamics)
// =============================================================================
// Iteratively adjusts positions to satisfy bond distance constraints
// This keeps crystal structures rigid

struct ConstraintParams {
  particleCount : u32,
  bondCount : u32,
  bondBreakDistance : f32,
  iterations : u32,
};

@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> particlePhase : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> bonds : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params : ConstraintParams;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let bondIdx = gid.x;
  if (bondIdx >= params.bondCount) { return; }
  
  var bond = bonds[bondIdx];
  let idxA = u32(bond.x);
  let idxB = u32(bond.y);
  let restDist = bond.z;
  let stiffness = bond.w;
  
  // Skip invalid bonds
  if (idxA >= params.particleCount || idxB >= params.particleCount) { return; }
  if (restDist < 0.001) { return; }  // Broken bond
  
  let posA = positions[idxA].xyz;
  let posB = positions[idxB].xyz;
  let phaseA = particlePhase[idxA].z;
  let phaseB = particlePhase[idxB].z;
  
  // Both must still be frozen
  if (phaseA < 0.9 || phaseB < 0.9) {
    // Break bond if either particle melted
    bond.z = 0.0;  // Mark as broken
    bonds[bondIdx] = bond;
    return;
  }
  
  let delta = posB - posA;
  let dist = length(delta);
  
  // Check for bond breakage
  if (dist > params.bondBreakDistance) {
    bond.z = 0.0;  // Mark as broken
    bonds[bondIdx] = bond;
    return;
  }
  
  if (dist < 0.001) { return; }
  
  // PBD constraint: move particles to satisfy distance constraint
  let error = dist - restDist;
  let direction = delta / dist;
  
  // Each particle moves half the correction (equal mass assumption)
  let correction = direction * error * stiffness * 0.5;
  
  // Apply corrections (this creates race conditions but averages out over iterations)
  let ageA = positions[idxA].w;
  let ageB = positions[idxB].w;
  positions[idxA] = vec4<f32>(posA + correction, ageA);
  positions[idxB] = vec4<f32>(posB - correction, ageB);
  
  // Also adjust velocities to match constraint
  let velA = velocities[idxA].xyz;
  let velB = velocities[idxB].xyz;
  let relVel = velB - velA;
  let normalVel = dot(relVel, direction);
  
  // Dampen relative velocity along bond axis
  let velCorrection = direction * normalVel * 0.3;
  velocities[idxA] = vec4<f32>(velA + velCorrection, velocities[idxA].w);
  velocities[idxB] = vec4<f32>(velB - velCorrection, velocities[idxB].w);
}
`;
}

/**
 * Create compute pipeline for solid particle collision
 */
export function createSolidCollisionPipeline(device, workgroupSize = 256) {
  const shaderCode = createSolidCollisionShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "SolidCollision Shader",
    code: shaderCode,
  });
  
  const pipeline = device.createComputePipeline({
    label: "SolidCollision Pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });
  
  // CollisionParams: 16 values (see struct in shader)
  const paramsBuffer = device.createBuffer({
    label: "SolidCollisionParams",
    size: 64, // 16 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "velocities", binding: 1 },
      { name: "particlePhase", binding: 2 },
      { name: "colliders", binding: 3 },
      { name: "params", binding: 4 },
    ],
    { label: "SolidCollision.bindGroup", maxEntries: 256, getBindGroup: externalGetBindGroup }
  );
  
  return { pipeline, paramsBuffer, workgroupSize, bindGroups };
}

/**
 * Create compute pipeline for crystal bond formation
 */
export function createCrystalBondPipeline(device, workgroupSize = 256) {
  const shaderCode = createCrystalBondShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "CrystalBond Shader",
    code: shaderCode,
  });
  
  const pipeline = device.createComputePipeline({
    label: "CrystalBond Pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });
  
  // BondParams: 8 values
  const paramsBuffer = device.createBuffer({
    label: "CrystalBondParams",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "particlePhase", binding: 1 },
      { name: "bonds", binding: 2 },
      { name: "bondCounts", binding: 3 },
      { name: "bondCounter", binding: 4 },
      { name: "params", binding: 5 },
    ],
    { label: "CrystalBond.bindGroup", maxEntries: 256, getBindGroup: externalGetBindGroup }
  );
  
  return { pipeline, paramsBuffer, workgroupSize, bindGroups };
}

/**
 * Create compute pipeline for bond constraint solving
 */
export function createBondConstraintPipeline(device, workgroupSize = 256) {
  const shaderCode = createBondConstraintShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "BondConstraint Shader",
    code: shaderCode,
  });
  
  const pipeline = device.createComputePipeline({
    label: "BondConstraint Pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });
  
  // ConstraintParams: 4 values
  const paramsBuffer = device.createBuffer({
    label: "BondConstraintParams",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "velocities", binding: 1 },
      { name: "particlePhase", binding: 2 },
      { name: "bonds", binding: 3 },
      { name: "params", binding: 4 },
    ],
    { label: "BondConstraint.bindGroup", maxEntries: 256, getBindGroup: externalGetBindGroup }
  );
  
  return { pipeline, paramsBuffer, workgroupSize, bindGroups };
}

/**
 * Step the solid collision system
 * @param {GPUDevice} device
 * @param {Object} collisionPipeline - from createSolidCollisionPipeline
 * @param {Object} phaseBuffers - from createPhaseChangeBuffers
 * @param {Object} particleWorld - particle sim world
 * @param {Object} colliderData - { buffer, count } entity colliders
 * @param {Object} roomBounds - { min: [x,y,z], max: [x,y,z] }
 * @param {number} dt - delta time
 * @param {Object} options - collision params overrides
 */
export function stepSolidCollision(device, collisionPipeline, phaseBuffers, particleWorld, colliderData, roomBounds, dt, options = {}) {
  if (!collisionPipeline || !phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  const params = { ...DEFAULT_SOLID_COLLISION_PARAMS, ...options };
  const roomMin = roomBounds?.min || [-25, -25, -25];
  const roomMax = roomBounds?.max || [25, 25, 25];
  
  // Build params buffer (must match CollisionParams struct)
  const paramsData = new Float32Array(16);
  const paramsU32 = new Uint32Array(paramsData.buffer);
  
  paramsU32[0] = particleCount;             // particleCount : u32
  paramsU32[1] = colliderData?.count || 0;  // colliderCount : u32
  paramsData[2] = params.particleRadius;    // particleRadius : f32
  paramsData[3] = params.collisionStiffness; // collisionStiffness : f32
  
  paramsData[4] = params.friction;           // friction : f32
  paramsData[5] = params.restitution;        // restitution : f32
  paramsData[6] = params.tempTransferRate;   // tempTransferRate : f32
  paramsData[7] = params.contactCoolingBoost; // contactCoolingBoost : f32
  
  paramsData[8] = roomMin[0];   // roomMinX
  paramsData[9] = roomMin[1];   // roomMinY
  paramsData[10] = roomMin[2];  // roomMinZ
  paramsData[11] = roomMax[0];  // roomMaxX
  paramsData[12] = roomMax[1];  // roomMaxY
  paramsData[13] = roomMax[2];  // roomMaxZ
  
  paramsData[14] = dt;                       // dt : f32
  paramsData[15] = params.bondFormDistance;  // neighborRadius : f32
  
  device.queue.writeBuffer(collisionPipeline.paramsBuffer, 0, paramsData);
  
  // Get collider buffer (or create dummy)
  const colliderBuffer = colliderData?.buffer || particleWorld.colliderBuffer;
  
  const bindGroup = collisionPipeline.bindGroups.get({
    positions: particleWorld.positionBuffer,
    velocities: particleWorld.velocityBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    colliders: colliderBuffer,
    params: collisionPipeline.paramsBuffer,
  }, "PhaseChange.SolidCollision.bindGroup");
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(collisionPipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  
  const workgroups = Math.ceil(particleCount / collisionPipeline.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  
  device.queue.submit([encoder.finish()]);
}

/**
 * Step the crystal bond formation system
 */
export function stepCrystalBonds(device, bondPipeline, phaseBuffers, particleWorld, options = {}) {
  if (!bondPipeline || !phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  const params = { ...DEFAULT_SOLID_COLLISION_PARAMS, ...options };
  
  // Build params buffer (must match BondParams struct)
  const paramsData = new Uint32Array(8);
  const paramsF32 = new Float32Array(paramsData.buffer);
  
  paramsData[0] = particleCount;              // particleCount : u32
  paramsF32[1] = params.bondFormDistance;     // bondFormDistance : f32
  paramsF32[2] = params.bondBreakDistance;    // bondBreakDistance : f32
  paramsF32[3] = params.bondStiffness;        // bondStiffness : f32
  paramsData[4] = params.maxBondsPerParticle; // maxBondsPerParticle : u32
  paramsData[5] = 0;                          // currentBondCount (unused here)
  paramsData[6] = phaseBuffers.maxBonds;      // maxBonds : u32
  paramsData[7] = 0;                          // _pad
  
  device.queue.writeBuffer(bondPipeline.paramsBuffer, 0, paramsData);
  
  const bindGroup = bondPipeline.bindGroups.get({
    positions: particleWorld.positionBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    bonds: phaseBuffers.bondBuffer,
    bondCounts: phaseBuffers.bondCountBuffer,
    bondCounter: phaseBuffers.bondCounterBuffer,
    params: bondPipeline.paramsBuffer,
  }, "PhaseChange.CrystalBond.bindGroup");
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(bondPipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  
  const workgroups = Math.ceil(particleCount / bondPipeline.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  
  device.queue.submit([encoder.finish()]);
}

/**
 * Step the bond constraint solver (PBD)
 * Run multiple iterations for stability
 */
export function stepBondConstraints(device, constraintPipeline, phaseBuffers, particleWorld, bondCount, options = {}) {
  if (!constraintPipeline || !phaseBuffers || !particleWorld) return;
  if (bondCount === 0) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  const iterations = options.iterations || 4;
  const params = { ...DEFAULT_SOLID_COLLISION_PARAMS, ...options };
  
  // Build params buffer
  const paramsData = new Uint32Array(4);
  const paramsF32 = new Float32Array(paramsData.buffer);
  
  paramsData[0] = particleCount;            // particleCount : u32
  paramsData[1] = bondCount;                // bondCount : u32
  paramsF32[2] = params.bondBreakDistance;  // bondBreakDistance : f32
  paramsData[3] = iterations;               // iterations : u32
  
  device.queue.writeBuffer(constraintPipeline.paramsBuffer, 0, paramsData);
  
  const bindGroup = constraintPipeline.bindGroups.get({
    positions: particleWorld.positionBuffer,
    velocities: particleWorld.velocityBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    bonds: phaseBuffers.bondBuffer,
    params: constraintPipeline.paramsBuffer,
  }, "PhaseChange.BondConstraint.bindGroup");
  
  // Run multiple iterations for stable constraint solving
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(constraintPipeline.pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(bondCount / constraintPipeline.workgroupSize);
  for (let iter = 0; iter < iterations; iter++) {
    pass.dispatchWorkgroups(workgroups);
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
}

function getOrCreateFreezeSeedState(device) {
  let state = freezeSeedStateByDevice.get(device);
  if (state) return state;

  const shaderCode = /* wgsl */`
struct SeedParams {
  centerX : f32, centerY : f32, centerZ : f32,
  radius : f32,
  seedStrength : f32,
  temperature : f32,
  magicSaturation : f32,
  particleCount : u32,
};

@group(0) @binding(0) var<storage, read> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> particlePhase : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> seedData : array<f32>;
@group(0) @binding(3) var<uniform> params : SeedParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let pos = positions[idx].xyz;
  let center = vec3<f32>(params.centerX, params.centerY, params.centerZ);
  let dist = length(pos - center);
  
  if (dist < params.radius) {
    let falloff = 1.0 - (dist / params.radius);
    let weight = falloff * falloff;
    
    var data = particlePhase[idx];
    data.x = min(data.x, params.temperature * weight + data.x * (1.0 - weight));
    data.y = max(data.y, params.magicSaturation * weight);
    particlePhase[idx] = data;
    
    seedData[idx] = max(seedData[idx], params.seedStrength * weight);
  }
}
`;

  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  });

  const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;
  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "particlePhase", binding: 1 },
      { name: "seedData", binding: 2 },
      { name: "params", binding: 3 },
    ],
    { label: "PhaseChange.injectFreezeSeeds.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
  );

  state = { pipeline, uniformBuffer, bindGroups };
  freezeSeedStateByDevice.set(device, state);
  return state;
}

function getOrCreateHeatSeedState(device) {
  let state = heatSeedStateByDevice.get(device);
  if (state) return state;

  const shaderCode = /* wgsl */`
struct HeatParams {
  centerX : f32, centerY : f32, centerZ : f32,
  radius : f32,
  strength : f32,
  temperature : f32,
  magicDamp : f32,
  particleCount : u32,
};

@group(0) @binding(0) var<storage, read> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> particlePhase : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> seedData : array<f32>;
@group(0) @binding(3) var<uniform> params : HeatParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let pos = positions[idx].xyz;
  let center = vec3<f32>(params.centerX, params.centerY, params.centerZ);
  let dist = length(pos - center);
  
  if (dist < params.radius) {
    let falloff = 1.0 - (dist / params.radius);
    let weight = falloff * falloff * params.strength;
    
    var data = particlePhase[idx];
    let targetTemp = params.temperature;
    data.x = max(data.x, targetTemp * weight + data.x * (1.0 - weight));
    data.y = data.y * (1.0 - params.magicDamp * weight);
    particlePhase[idx] = data;
    
    let currentSeed = seedData[idx];
    let newSeed = currentSeed * (1.0 - params.strength * weight);
    seedData[idx] = max(0.0, newSeed);
  }
}
`;

  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  });

  const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;
  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "particlePhase", binding: 1 },
      { name: "seedData", binding: 2 },
      { name: "params", binding: 3 },
    ],
    { label: "PhaseChange.injectHeatSeeds.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
  );

  state = { pipeline, uniformBuffer, bindGroups };
  heatSeedStateByDevice.set(device, state);
  return state;
}

function getOrCreatePhaseVisualState(device) {
  let state = phaseVisualStateByDevice.get(device);
  if (state) return state;

  const shaderCode = /* wgsl */`
struct VisualParams {
  particleCount : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
  frigidColor : vec4<f32>,
  frozenColor : vec4<f32>,
  freezingColor : vec4<f32>,
  hotColor : vec4<f32>,
};

@group(0) @binding(0) var<storage, read> particlePhase : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> particleMeta : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : VisualParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let phase = particlePhase[idx];
  let temp = phase.x;
  let phaseEnergy = phase.z;
  
  var meta = particleMeta[idx];
  
  var targetColor = vec3<f32>(meta.x, meta.y, meta.z);
  var blendAmount = 0.0;
  
  if (temp < 0.0) {
    if (temp > -30.0) {
      let t = -temp / 30.0;
      targetColor = mix(params.freezingColor.xyz, params.frozenColor.xyz, t);
      blendAmount = 0.5 + t * 0.3;
    } else {
      let t = (-temp - 30.0) / 70.0;
      targetColor = mix(params.frozenColor.xyz, params.frigidColor.xyz, t);
      blendAmount = 0.8 + t * 0.15;
    }
  } else if (temp > 50.0) {
    let t = (temp - 50.0) / 50.0;
    targetColor = mix(vec3<f32>(meta.x, meta.y, meta.z), params.hotColor.xyz, t);
    blendAmount = t * 0.6;
  }
  
  if (phaseEnergy > 0.1) {
    blendAmount = max(blendAmount, phaseEnergy * 0.7);
  }
  
  if (blendAmount > 0.01) {
    meta.x = mix(meta.x, targetColor.x, blendAmount);
    meta.y = mix(meta.y, targetColor.y, blendAmount);
    meta.z = mix(meta.z, targetColor.z, blendAmount);
    particleMeta[idx] = meta;
  }
}
`;

  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  });

  const uniformBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;
  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "particlePhase", binding: 0 },
      { name: "particleMeta", binding: 1 },
      { name: "params", binding: 2 },
    ],
    { label: "PhaseChange.applyPhaseVisuals.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
  );

  state = { pipeline, uniformBuffer, bindGroups };
  phaseVisualStateByDevice.set(device, state);
  return state;
}

/**
 * Read bond count from GPU (async)
 */
export async function readBondCount(device, phaseBuffers) {
  if (!phaseBuffers?.bondCounterBuffer) return 0;
  
  const readBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(phaseBuffers.bondCounterBuffer, 0, readBuffer, 0, 4);
  device.queue.submit([encoder.finish()]);
  
  await readBuffer.mapAsync(GPUMapMode.READ);
  const data = new Uint32Array(readBuffer.getMappedRange());
  const count = data[0];
  readBuffer.unmap();
  readBuffer.destroy();
  
  return count;
}

/**
 * Clear all bonds (for reset or when spawning rigid body)
 */
export function clearBonds(device, phaseBuffers) {
  if (!phaseBuffers) return;
  
  const encoder = device.createCommandEncoder();
  if (phaseBuffers.bondBuffer) encoder.clearBuffer(phaseBuffers.bondBuffer);
  if (phaseBuffers.bondCountBuffer) encoder.clearBuffer(phaseBuffers.bondCountBuffer);
  if (phaseBuffers.bondCounterBuffer) encoder.clearBuffer(phaseBuffers.bondCounterBuffer);
  device.queue.submit([encoder.finish()]);
}

/**
 * Full crystal system - combines all steps
 * Call this each frame to handle solidification, collision, bonding, and constraints
 */
export function stepCrystalSystem(device, systems, phaseBuffers, particleWorld, colliderData, roomBounds, dt, options = {}) {
  if (!systems || !phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  // 1. Crystallization (temperature/magic spreading, phase transitions)
  if (systems.crystallization) {
    stepCrystallization(device, systems.crystallization, phaseBuffers, particleWorld, dt, options);
  }
  
  // 2. Solid collision (rigid collision for frozen particles, temp transfer)
  if (systems.solidCollision) {
    stepSolidCollision(device, systems.solidCollision, phaseBuffers, particleWorld, colliderData, roomBounds, dt, options);
  }
  
  // 3. Crystal bond formation (create bonds between nearby frozen particles)
  if (systems.crystalBond) {
    stepCrystalBonds(device, systems.crystalBond, phaseBuffers, particleWorld, options);
  }
  
  // 4. Bond constraint solving (PBD to maintain crystal rigidity)
  // Note: bondCount needs to be read from GPU or estimated
  if (systems.bondConstraint && phaseBuffers.maxBonds > 0) {
    // Estimate bond count as fraction of max (actual count requires async read)
    const estimatedBonds = Math.min(particleCount * 3, phaseBuffers.maxBonds);
    stepBondConstraints(device, systems.bondConstraint, phaseBuffers, particleWorld, estimatedBonds, options);
  }
  
  // 5. Visual updates (color frozen particles)
  if (options.applyVisuals !== false) {
    applyPhaseVisuals(device, phaseBuffers, particleWorld, options);
  }
}

/**
 * Create all crystal system pipelines at once
 */
export function createCrystalSystemPipelines(device, workgroupSize = 256) {
  return {
    crystallization: createCrystallizationPipeline(device, workgroupSize),
    solidCollision: createSolidCollisionPipeline(device, workgroupSize),
    crystalBond: createCrystalBondPipeline(device, workgroupSize),
    bondConstraint: createBondConstraintPipeline(device, workgroupSize),
  };
}

/**
 * Extract connected crystal clusters from bonds for rigid body spawning
 * Uses Union-Find algorithm to identify connected components
 */
export async function extractCrystalClusters(device, phaseBuffers, particleWorld, minClusterSize = 5) {
  if (!phaseBuffers || !particleWorld) return [];
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return [];
  
  // Read bonds, positions, and phase data from GPU
  const bondCount = await readBondCount(device, phaseBuffers);
  if (bondCount === 0) return [];
  
  const bondReadSize = bondCount * BOND_STRIDE * 4;
  const posReadSize = particleCount * 16;
  const phaseReadSize = particleCount * PARTICLE_PHASE_STRIDE * 4;
  
  const bondReadBuffer = device.createBuffer({
    size: bondReadSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const posReadBuffer = device.createBuffer({
    size: posReadSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const phaseReadBuffer = device.createBuffer({
    size: phaseReadSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(phaseBuffers.bondBuffer, 0, bondReadBuffer, 0, bondReadSize);
  encoder.copyBufferToBuffer(particleWorld.positionBuffer, 0, posReadBuffer, 0, posReadSize);
  encoder.copyBufferToBuffer(phaseBuffers.particlePhaseBuffer, 0, phaseReadBuffer, 0, phaseReadSize);
  device.queue.submit([encoder.finish()]);
  
  await Promise.all([
    bondReadBuffer.mapAsync(GPUMapMode.READ),
    posReadBuffer.mapAsync(GPUMapMode.READ),
    phaseReadBuffer.mapAsync(GPUMapMode.READ),
  ]);
  
  const bondData = new Float32Array(bondReadBuffer.getMappedRange());
  const posData = new Float32Array(posReadBuffer.getMappedRange());
  const phaseData = new Float32Array(phaseReadBuffer.getMappedRange());
  
  // Union-Find for connected components
  const parent = new Int32Array(particleCount);
  const rank = new Int32Array(particleCount);
  for (let i = 0; i < particleCount; i++) parent[i] = i;
  
  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  
  function union(x, y) {
    const px = find(x), py = find(y);
    if (px === py) return;
    if (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
  }
  
  // Build connected components from active bonds
  for (let i = 0; i < bondCount; i++) {
    const idxA = Math.floor(bondData[i * BOND_STRIDE]);
    const idxB = Math.floor(bondData[i * BOND_STRIDE + 1]);
    const restDist = bondData[i * BOND_STRIDE + 2];
    
    // Skip broken bonds (restDist = 0)
    if (restDist < 0.001) continue;
    if (idxA < 0 || idxA >= particleCount || idxB < 0 || idxB >= particleCount) continue;
    
    union(idxA, idxB);
  }
  
  // Group particles by cluster
  const clusterMap = new Map();
  for (let i = 0; i < particleCount; i++) {
    const phaseEnergy = phaseData[i * PARTICLE_PHASE_STRIDE + 2];
    if (phaseEnergy < 0.9) continue; // Only frozen particles
    
    const root = find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(i);
  }
  
  // Build cluster data
  const clusters = [];
  for (const [root, particles] of clusterMap) {
    if (particles.length < minClusterSize) continue;
    
    // Compute center of mass and bounds
    let centerOfMass = [0, 0, 0];
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    
    for (const idx of particles) {
      const pos = [
        posData[idx * 4],
        posData[idx * 4 + 1],
        posData[idx * 4 + 2],
      ];
      for (let j = 0; j < 3; j++) {
        centerOfMass[j] += pos[j];
        min[j] = Math.min(min[j], pos[j]);
        max[j] = Math.max(max[j], pos[j]);
      }
    }
    
    centerOfMass = centerOfMass.map(v => v / particles.length);
    const halfExtents = [
      (max[0] - min[0]) * 0.5 + 0.1,
      (max[1] - min[1]) * 0.5 + 0.1,
      (max[2] - min[2]) * 0.5 + 0.1,
    ];
    
    clusters.push({
      rootParticle: root,
      particleCount: particles.length,
      particleIndices: particles,
      centerOfMass,
      halfExtents,
      bounds: { min, max },
    });
  }
  
  // Cleanup
  bondReadBuffer.unmap();
  posReadBuffer.unmap();
  phaseReadBuffer.unmap();
  bondReadBuffer.destroy();
  posReadBuffer.destroy();
  phaseReadBuffer.destroy();
  
  return clusters;
}

/**
 * Inject seed particles at a position (ice spell impact, magic anchor, etc.)
 */
export function createSeedInjectionParams(position, radius, seedStrength, temperature, magicSaturation) {
  return {
    position: [...position],
    radius: radius || 1.0,
    seedStrength: seedStrength || 1.0,
    temperature: temperature ?? -30.0,  // Very cold by default
    magicSaturation: magicSaturation ?? 0.8,  // High magic by default
  };
}

/**
 * Create compute pipeline for crystallization chain reaction
 */
export function createCrystallizationPipeline(device, workgroupSize = 256) {
  const shaderCode = createCrystallizationShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "Crystallization Shader",
    code: shaderCode,
  });
  
  const pipeline = device.createComputePipeline({
    label: "Crystallization Pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });
  
  // Params buffer: matches CrystalParams struct (19 floats + 1 pad = 80 bytes)
  const paramsBuffer = device.createBuffer({
    label: "CrystalParams",
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const bindGroups = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "particlePhase", binding: 1 },
      { name: "seed", binding: 2 },
      { name: "params", binding: 3 },
    ],
    { label: "Crystallization.bindGroup", maxEntries: 128, getBindGroup: externalGetBindGroup }
  );
  
  return { pipeline, paramsBuffer, workgroupSize, bindGroups };
}

/**
 * Step the crystallization system - run compute pass to propagate freezing
 */
export function stepCrystallization(device, crystallization, phaseBuffers, particleWorld, dt, options = {}) {
  if (!crystallization || !phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  const params = { ...DEFAULT_CRYSTAL_PARAMS, ...options };
  
  // Build params data (must match CrystalParams struct layout)
  // Use ArrayBuffer with views to handle mixed u32/f32 types correctly
  const paramsBuffer = new ArrayBuffer(80);
  const paramsF32 = new Float32Array(paramsBuffer);
  const paramsU32 = new Uint32Array(paramsBuffer);
  
  paramsU32[0] = particleCount;             // particleCount : u32
  paramsF32[1] = params.neighborRadius;     // neighborRadius : f32
  paramsF32[2] = params.freezeThreshold;    // freezeThreshold : f32
  paramsF32[3] = params.meltThreshold;      // meltThreshold : f32
  paramsF32[4] = params.magicFreezeThreshold; // magicFreezeThreshold : f32
  paramsF32[5] = params.magicDecayRate;     // magicDecayRate : f32
  paramsF32[6] = params.latentHeatFreeze;   // latentHeatFreeze : f32
  paramsF32[7] = params.latentHeatMelt;     // latentHeatMelt : f32
  paramsF32[8] = params.tempSpreadRate;     // tempSpreadRate : f32
  paramsF32[9] = params.magicSpreadRate;    // magicSpreadRate : f32
  paramsF32[10] = params.seedBoostFactor;   // seedBoostFactor : f32
  paramsF32[11] = params.warmingRate;       // warmingRate : f32
  paramsF32[12] = params.freezeRate;        // freezeRate : f32
  paramsF32[13] = params.meltRate;          // meltRate : f32
  paramsF32[14] = dt;                       // dt : f32
  paramsF32[15] = params.ambientTemp;       // ambientTemp : f32
  paramsU32[16] = params.minClusterSize;    // minClusterSize : u32
  paramsU32[17] = 0;                        // _pad : u32
  
  device.queue.writeBuffer(crystallization.paramsBuffer, 0, paramsBuffer);
  
  const bindGroup = crystallization.bindGroups.get({
    positions: particleWorld.positionBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    seed: phaseBuffers.seedBuffer,
    params: crystallization.paramsBuffer,
  }, "PhaseChange.Crystallization.bindGroup");
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(crystallization.pipeline);
  pass.setBindGroup(0, bindGroup);
  
  const workgroups = Math.ceil(particleCount / crystallization.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  
  device.queue.submit([encoder.finish()]);
}

/**
 * Inject freeze seeds at a world position (for ice spell impact)
 * Affects particles within radius - sets their temp/magic/seed values
 */
export function injectFreezeSeeds(device, phaseBuffers, particleWorld, seedParams) {
  if (!phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  const { position, radius, seedStrength, temperature, magicSaturation } = seedParams;
  
  const state = getOrCreateFreezeSeedState(device);

  // Mixed types: 7 floats + 1 u32
  const paramsArrayBuffer = new ArrayBuffer(32);
  const paramsF32 = new Float32Array(paramsArrayBuffer);
  const paramsU32 = new Uint32Array(paramsArrayBuffer);
  paramsF32[0] = position[0];
  paramsF32[1] = position[1];
  paramsF32[2] = position[2];
  paramsF32[3] = radius;
  paramsF32[4] = seedStrength;
  paramsF32[5] = temperature;
  paramsF32[6] = magicSaturation;
  paramsU32[7] = particleCount;
  device.queue.writeBuffer(state.uniformBuffer, 0, paramsArrayBuffer);

  const bindGroup = state.bindGroups.get({
    positions: particleWorld.positionBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    seedData: phaseBuffers.seedBuffer,
    params: state.uniformBuffer,
  });
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

export function injectHeatSeeds(device, phaseBuffers, particleWorld, seedParams) {
  if (!phaseBuffers || !particleWorld) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  const { position, radius, seedStrength, temperature, magicSaturation } = seedParams;
  
  const state = getOrCreateHeatSeedState(device);

  const paramsArrayBuffer = new ArrayBuffer(32);
  const paramsF32 = new Float32Array(paramsArrayBuffer);
  const paramsU32 = new Uint32Array(paramsArrayBuffer);
  paramsF32[0] = position[0];
  paramsF32[1] = position[1];
  paramsF32[2] = position[2];
  paramsF32[3] = radius;
  paramsF32[4] = seedStrength;
  paramsF32[5] = temperature;
  paramsF32[6] = magicSaturation;
  paramsU32[7] = particleCount;
  device.queue.writeBuffer(state.uniformBuffer, 0, paramsArrayBuffer);

  const bindGroup = state.bindGroups.get({
    positions: particleWorld.positionBuffer,
    particlePhase: phaseBuffers.particlePhaseBuffer,
    seedData: phaseBuffers.seedBuffer,
    params: state.uniformBuffer,
  });
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Apply visual effects based on phase state (color frozen particles blue/white)
 * Call this after stepCrystallization to update particle rendering
 */
export function applyPhaseVisuals(device, phaseBuffers, particleWorld, options = {}) {
  if (!phaseBuffers || !particleWorld || !particleWorld.metaBuffer) return;
  
  const particleCount = particleWorld.instanceCount || 0;
  if (particleCount === 0) return;
  
  // Color gradient based on temperature:
  // Hot (100°C):   Red/Orange
  // Warm (20°C):   Original color
  // Cool (0°C):    Light blue (freezing)
  // Cold (-30°C):  Ice blue (frozen)
  // Frigid (-100°C): White (deep freeze)
  
  const frigidColor = options.frigidColor || [0.95, 0.98, 1.0];   // White (very cold, -100°C)
  const frozenColor = options.frozenColor || [0.6, 0.85, 1.0];    // Ice blue (-30°C)
  const freezingColor = options.freezingColor || [0.7, 0.9, 1.0]; // Light blue (0°C)
  const hotColor = options.hotColor || [1.0, 0.4, 0.2];           // Orange/red (100°C)
  
  const state = getOrCreatePhaseVisualState(device);
  
  const paramsArrayBuffer = new ArrayBuffer(80);
  const paramsF32 = new Float32Array(paramsArrayBuffer);
  const paramsU32 = new Uint32Array(paramsArrayBuffer);
  
  // Header: particleCount + 3 padding
  paramsU32[0] = particleCount;
  paramsU32[1] = 0;  // _pad0
  paramsU32[2] = 0;  // _pad1
  paramsU32[3] = 0;  // _pad2
  
  // frigidColor (vec4 at offset 16)
  paramsF32[4] = frigidColor[0];
  paramsF32[5] = frigidColor[1];
  paramsF32[6] = frigidColor[2];
  paramsF32[7] = 1.0;
  
  // frozenColor (vec4 at offset 32)
  paramsF32[8] = frozenColor[0];
  paramsF32[9] = frozenColor[1];
  paramsF32[10] = frozenColor[2];
  paramsF32[11] = 1.0;
  
  // freezingColor (vec4 at offset 48)
  paramsF32[12] = freezingColor[0];
  paramsF32[13] = freezingColor[1];
  paramsF32[14] = freezingColor[2];
  paramsF32[15] = 1.0;
  
  // hotColor (vec4 at offset 64)
  paramsF32[16] = hotColor[0];
  paramsF32[17] = hotColor[1];
  paramsF32[18] = hotColor[2];
  paramsF32[19] = 1.0;
  
  device.queue.writeBuffer(state.uniformBuffer, 0, paramsArrayBuffer);

  const bindGroup = state.bindGroups.get({
    particlePhase: phaseBuffers.particlePhaseBuffer,
    particleMeta: particleWorld.metaBuffer,
    params: state.uniformBuffer,
  });
  
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Extract frozen region as convex hull for rigid body creation
 * This runs on CPU after GPU freeze pass
 */
export async function extractFrozenShape(device, phaseChangeBuffers, gridSize, worldMin, cellSize) {
  const [gx, gy, gz] = gridSize;
  const cellCount = gx * gy * gz;
  
  // Read freeze region buffer back to CPU
  const readBuffer = device.createBuffer({
    size: cellCount * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(phaseChangeBuffers.freezeRegionBuffer, 0, readBuffer, 0, cellCount * 4);
  device.queue.submit([encoder.finish()]);
  
  await readBuffer.mapAsync(GPUMapMode.READ);
  const freezeData = new Float32Array(readBuffer.getMappedRange());
  
  // Find cells with frozen density
  const frozenCells = [];
  let totalMass = 0;
  let centerOfMass = [0, 0, 0];
  
  for (let z = 0; z < gz; z++) {
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        const idx = z * gx * gy + y * gx + x;
        const density = freezeData[idx];
        
        if (density > 0.01) {
          const worldPos = [
            worldMin[0] + (x + 0.5) * cellSize,
            worldMin[1] + (y + 0.5) * cellSize,
            worldMin[2] + (z + 0.5) * cellSize,
          ];
          
          frozenCells.push({ x, y, z, density, worldPos });
          totalMass += density;
          centerOfMass[0] += worldPos[0] * density;
          centerOfMass[1] += worldPos[1] * density;
          centerOfMass[2] += worldPos[2] * density;
        }
      }
    }
  }
  
  readBuffer.unmap();
  readBuffer.destroy();
  
  if (frozenCells.length === 0 || totalMass < 0.01) {
    return null;
  }
  
  // Normalize center of mass
  centerOfMass[0] /= totalMass;
  centerOfMass[1] /= totalMass;
  centerOfMass[2] /= totalMass;
  
  // Compute bounding box for simple shape
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  
  for (const cell of frozenCells) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], cell.worldPos[i] - cellSize * 0.5);
      max[i] = Math.max(max[i], cell.worldPos[i] + cellSize * 0.5);
    }
  }
  
  const halfExtents = [
    (max[0] - min[0]) * 0.5,
    (max[1] - min[1]) * 0.5,
    (max[2] - min[2]) * 0.5,
  ];
  
  return {
    centerOfMass,
    halfExtents,
    mass: totalMass,
    cellCount: frozenCells.length,
    cells: frozenCells,
    bounds: { min, max },
  };
}

/**
 * Clear freeze region after rigid body is spawned
 */
export function clearFreezeRegion(device, phaseChangeBuffers) {
  const encoder = device.createCommandEncoder();
  encoder.clearBuffer(phaseChangeBuffers.freezeRegionBuffer);
  device.queue.submit([encoder.finish()]);
}

/**
 * Inject mass/momentum when melting a rigid body
 */
export function injectMeltedFluid(device, fluidWorld, position, velocity, mass, radius) {
  // This would call the existing splat function with the melted fluid params
  // For now, return the injection parameters
  return {
    position,
    velocity,
    mass,
    radius,
    temperature: 20.0, // Melted fluid is at ambient temp
  };
}

/**
 * Destroy phase change buffers
 */
export function destroyPhaseChangeBuffers(buffers) {
  if (!buffers) return;
  buffers.cellPhaseBuffer?.destroy();
  buffers.temperatureBuffer?.destroy();
  buffers.freezeRegionBuffer?.destroy();
  buffers.particlePhaseBuffer?.destroy();
  buffers.seedBuffer?.destroy();
  buffers.paramsBuffer?.destroy();
  buffers.bondBuffer?.destroy();
  buffers.bondCountBuffer?.destroy();
  buffers.bondCounterBuffer?.destroy();
}

/**
 * Destroy crystal system pipelines
 */
export function destroyCrystalSystemPipelines(systems) {
  if (!systems) return;
  systems.crystallization?.paramsBuffer?.destroy();
  systems.solidCollision?.paramsBuffer?.destroy();
  systems.crystalBond?.paramsBuffer?.destroy();
  systems.bondConstraint?.paramsBuffer?.destroy();
}

/**
 * Extract frozen particle cluster for rigid body spawning
 * Returns particles that are FROZEN phase and form a connected cluster
 */
export async function extractFrozenParticles(device, phaseBuffer, positionBuffer, particleCount, minClusterSize = 5) {
  // Read back particle phase data
  const readSize = particleCount * PARTICLE_PHASE_STRIDE * 4;
  const phaseReadBuffer = device.createBuffer({
    size: readSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const posReadBuffer = device.createBuffer({
    size: particleCount * 16, // vec4 per particle
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(phaseBuffer, 0, phaseReadBuffer, 0, readSize);
  encoder.copyBufferToBuffer(positionBuffer, 0, posReadBuffer, 0, particleCount * 16);
  device.queue.submit([encoder.finish()]);
  
  await Promise.all([
    phaseReadBuffer.mapAsync(GPUMapMode.READ),
    posReadBuffer.mapAsync(GPUMapMode.READ),
  ]);
  
  const phaseData = new Float32Array(phaseReadBuffer.getMappedRange());
  const posData = new Float32Array(posReadBuffer.getMappedRange());
  
  // Find all frozen particles
  const frozenParticles = [];
  for (let i = 0; i < particleCount; i++) {
    const phase = phaseData[i * PARTICLE_PHASE_STRIDE + 2];
    if (phase >= 2.0) { // FROZEN
      frozenParticles.push({
        index: i,
        position: [posData[i * 4], posData[i * 4 + 1], posData[i * 4 + 2]],
        temperature: phaseData[i * PARTICLE_PHASE_STRIDE],
        magic: phaseData[i * PARTICLE_PHASE_STRIDE + 1],
      });
    }
  }
  
  phaseReadBuffer.unmap();
  posReadBuffer.unmap();
  phaseReadBuffer.destroy();
  posReadBuffer.destroy();
  
  if (frozenParticles.length < minClusterSize) {
    return null;
  }
  
  // Compute center of mass and bounds
  let centerOfMass = [0, 0, 0];
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  
  for (const p of frozenParticles) {
    for (let i = 0; i < 3; i++) {
      centerOfMass[i] += p.position[i];
      min[i] = Math.min(min[i], p.position[i]);
      max[i] = Math.max(max[i], p.position[i]);
    }
  }
  
  const count = frozenParticles.length;
  centerOfMass = centerOfMass.map(v => v / count);
  
  const halfExtents = [
    (max[0] - min[0]) * 0.5 + 0.1, // Small padding
    (max[1] - min[1]) * 0.5 + 0.1,
    (max[2] - min[2]) * 0.5 + 0.1,
  ];
  
  return {
    centerOfMass,
    halfExtents,
    particleCount: count,
    particles: frozenParticles,
    bounds: { min, max },
    // Indices of frozen particles (for removing from fluid sim)
    particleIndices: frozenParticles.map(p => p.index),
  };
}

export default {
  // Constants
  FluidPhase,
  PARTICLE_PHASE_STRIDE,
  BOND_STRIDE,
  MAX_BONDS_PER_PARTICLE,
  DEFAULT_CRYSTAL_PARAMS,
  DEFAULT_SOLID_COLLISION_PARAMS,
  
  // Buffer creation
  createPhaseChangeBuffers,
  
  // Spell forces
  createSpellForce,
  createSpellForceShader,
  
  // Freeze shader (grid-based)
  createFreezeShader,
  
  // Crystallization (particle-based phase transition)
  createCrystallizationShader,
  createCrystallizationPipeline,
  stepCrystallization,
  
  // Solid collision (frozen particles collide with everything)
  createSolidCollisionShader,
  createSolidCollisionPipeline,
  stepSolidCollision,
  
  // Crystal bonding (PBD constraints between frozen particles)
  createCrystalBondShader,
  createCrystalBondPipeline,
  stepCrystalBonds,
  createBondConstraintShader,
  createBondConstraintPipeline,
  stepBondConstraints,
  
  // Combined crystal system
  createCrystalSystemPipelines,
  stepCrystalSystem,
  destroyCrystalSystemPipelines,
  
  // Bond management
  readBondCount,
  clearBonds,
  
  // Cluster detection
  extractCrystalClusters,
  
  // Visual effects
  applyPhaseVisuals,
  
  // Seed injection
  injectFreezeSeeds,
  createSeedInjectionParams,
  
  // Shape extraction for rigid bodies
  extractFrozenShape,
  extractFrozenParticles,
  
  // Cleanup
  clearFreezeRegion,
  injectMeltedFluid,
  destroyPhaseChangeBuffers,
};
