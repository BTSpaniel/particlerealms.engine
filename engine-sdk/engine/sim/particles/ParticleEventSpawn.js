// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEventSpawn.js - GPU-driven sub-emitter spawning from particle events
 * 
 * Exceeds Niagara parity: Niagara events are CPU-only, this is fully GPU.
 * Zero-frame latency — sub-particles appear the same frame as the trigger event.
 * 
 * Pipeline:
 *   1. Main sim shader appends events to eventBuffer (death, collision, kill zone)
 *   2. IndirectDispatch builds freeList of dead particle slot indices
 *   3. THIS SHADER reads events + consumes free slots + writes new particles
 * 
 * Each workgroup handles one event. Threads within the workgroup spawn sub-particles.
 * Free slots are consumed atomically from the free list (no CPU involvement).
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { LEGACY_PARTICLE_RUNTIME_PCG_WGSL, LEGACY_PCG32_WGSL } from "../../core/math/MathBits.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_SUB_PARTICLES_PER_EVENT = 16;
const WORKGROUP_SIZE = 64; // One workgroup per event, threads handle sub-particles

// ============================================================================
// WGSL COMPUTE SHADER
// ============================================================================

const EVENT_SPAWN_SHADER = /* wgsl */`
struct SpawnConfig {
  subCount: u32,            // Sub-particles to spawn per event (1-16)
  inheritVelocity: f32,     // 0-1: how much parent velocity to inherit
  speed: f32,               // Base speed of spawned particles
  spread: f32,              // Angular spread (0=focused, 1=hemisphere, 2=sphere)
  lifetime: f32,            // Lifetime of spawned particles (seconds)
  size: f32,                // Packed size for meta.w
  inheritTemperature: f32,  // 0-1: fraction of parent temperature to inherit
  _pad0: f32,
  color: vec3<f32>,         // Sub-particle color (RGB)
  packedMetaW: f32,         // Full packed meta.w value (size+renderMode+shape+behavior)
  // Event type mask: which event types trigger this sub-emitter
  // Bit 0 = death (1), Bit 1 = groundCollision (2), Bit 2 = entityCollision (4), Bit 3 = killZone (8)
  eventMask: u32,
  maxSpawnPerFrame: u32,    // Global cap on spawned particles per frame
  _pad1: u32,
  _pad2: u32,
};

// Event buffer (read): written by main sim shader
@group(0) @binding(0) var<storage, read> eventBuffer: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> eventCounter: array<u32>;
// eventCounter[0] = eventCount

// Free list (read): built by IndirectDispatch scan
@group(0) @binding(2) var<storage, read> freeList: array<u32>;
@group(0) @binding(3) var<storage, read> freeCounters: array<u32>;
// freeCounters[2] = freeCount (offset 2 in IndirectDispatch counters)

// Particle output buffers (read_write): direct write to particle system
@group(1) @binding(0) var<storage, read_write> outPositions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read_write> outVelocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read_write> outMeta: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read_write> outUVs: array<vec4<f32>>;
@group(1) @binding(4) var<storage, read_write> outThermal: array<vec4<f32>>;

// Config + spawn counter + reaction table
@group(2) @binding(0) var<uniform> config: SpawnConfig;
@group(2) @binding(1) var<storage, read_write> spawnCounter: array<atomic<u32>>;
// spawnCounter[0] = total spawned this frame (atomic)
// spawnCounter[1] = freeList consume index (atomic)

// Reaction table for type-5 events (cross-emitter reactions)
struct ReactionRule {
  matA: u32, matB: u32, productMat: u32, spawnCount: u32,
  productColor: vec3<f32>, energyRelease: f32,
  productTemp: f32, productSize: f32, productLifetime: f32, flags: u32,
};
struct ReactionTable {
  count: u32, _pad0: u32, _pad1: u32, _pad2: u32,
  rules: array<ReactionRule, 32>,
};
@group(2) @binding(2) var<uniform> reactionTable: ReactionTable;

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_RUNTIME_PCG_WGSL}

fn randomDir(seed: ptr<function, u32>, spread: f32) -> vec3<f32> {
  let u = randomFloat(seed);
  let v = randomFloat(seed);
  let theta = u * 6.28318;
  let phi = acos(1.0 - v * min(spread, 2.0));
  return vec3<f32>(
    sin(phi) * cos(theta),
    cos(phi),
    sin(phi) * sin(theta),
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn spawnFromEvents(
  @builtin(workgroup_id) wgId: vec3<u32>,
  @builtin(local_invocation_index) localIdx: u32,
) {
  let eventIdx = wgId.x;
  let eventCount = eventCounter[0];
  if (eventIdx >= eventCount) { return; }

  // Read event data
  let evData0 = eventBuffer[eventIdx * 2u + 0u];
  let evData1 = eventBuffer[eventIdx * 2u + 1u];
  let eventPos = evData0.xyz;
  let eventType = evData0.w;
  let eventVel = evData1.xyz;
  let eventTemp = evData1.w;

  // Check event type mask
  let typeBit = 1u << (u32(eventType) - 1u);
  if ((config.eventMask & typeBit) == 0u) { return; }

  // ========== REACTION EVENTS (type 5): per-reaction product config ==========
  let isReaction = u32(eventType) == 5u;
  let ruleIdx = u32(eventTemp); // For type 5, evData1.w = reaction rule index
  var rSpawnCount = config.subCount;
  var rSpeed = config.speed;
  var rSpread = config.spread;
  var rLifetime = config.lifetime;
  var rSize = config.size;
  var rInheritVel = config.inheritVelocity;
  var rInheritTemp = config.inheritTemperature;
  var rColor = config.color;
  var rPackedMetaW = config.packedMetaW;
  var rTemp = eventTemp;
  var rProductMat = 0u;

  if (isReaction && ruleIdx < reactionTable.count) {
    let rule = reactionTable.rules[ruleIdx];
    rSpawnCount = rule.spawnCount;
    rColor = rule.productColor;
    rTemp = rule.productTemp;
    rSize = rule.productSize;
    rLifetime = rule.productLifetime;
    rSpeed = config.speed * 0.8; // Slightly slower than default
    rSpread = 2.0; // Sphere spread for reaction products
    rInheritVel = 0.2; // Low velocity inheritance
    rInheritTemp = 0.0; // Use product temperature directly
    rProductMat = rule.productMat;
    // Pack product size into metaW: sizeEncoded * 1e4 + renderMode(4=SDF) * 1e3
    let sizeEncoded = floor(rSize * 10.0);
    rPackedMetaW = sizeEncoded * 1e4 + 4000.0; // SDF billboard render mode
  }

  // Each thread in the workgroup handles one sub-particle
  if (localIdx >= rSpawnCount) { return; }

  // Check global spawn cap
  let spawnIdx = atomicAdd(&spawnCounter[0], 1u);
  if (spawnIdx >= config.maxSpawnPerFrame) { return; }

  // Consume a free slot from the free list
  let freeCount = freeCounters[2];
  let consumeIdx = atomicAdd(&spawnCounter[1], 1u);
  if (consumeIdx >= freeCount) { return; }
  let slotIdx = freeList[consumeIdx];

  // Generate deterministic random values
  var seed = pcg_hash(eventIdx * 17u + localIdx * 31u + spawnIdx);

  // Compute spawn velocity: inherit parent + random spread
  let dir = randomDir(&seed, rSpread);
  let inheritedVel = eventVel * rInheritVel;
  let spawnVel = inheritedVel + dir * rSpeed;

  // Small position offset to avoid Z-fighting
  let offset = dir * rSize * 0.5;
  let spawnPos = eventPos + offset;

  // Temperature: for reactions use product temp, otherwise inherit
  let spawnTemp = select(eventTemp * rInheritTemp, rTemp, isReaction);

  // Phase: derive from product temperature (gas if >373K for water-like, etc.)
  let spawnPhase = select(0.0, select(1.0, 2.0, spawnTemp > 373.0), spawnTemp > 273.0);

  // Material index for product (packed into thermal.z)
  let spawnMatPacked = f32(rProductMat & 0xFFu);

  // Write particle data to the claimed free slot
  outPositions[slotIdx] = vec4<f32>(spawnPos, 0.0); // age = 0
  outVelocities[slotIdx] = vec4<f32>(spawnVel, rLifetime);
  outMeta[slotIdx] = vec4<f32>(rColor, rPackedMetaW);
  outUVs[slotIdx] = vec4<f32>(0.0, 0.0, 0.0, randomFloat(&seed) * 6.28318); // random initial rotation
  outThermal[slotIdx] = vec4<f32>(spawnTemp, spawnPhase, spawnMatPacked, 0.0); // temp, phase, materialIdx, latent
}
`;

// ============================================================================
// SYSTEM CREATION
// ============================================================================

/**
 * Create the GPU event spawn system
 * @param {GPUDevice} device
 * @param {Object} options
 */
export function createEventSpawnSystem(device, options = {}) {
  const shaderModule = device.createShaderModule({
    label: "EventSpawn.shader",
    code: EVENT_SPAWN_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: "EventSpawn.pipeline",
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'spawnFromEvents' },
  });

  // Config uniform buffer (SpawnConfig struct = 48 bytes, round to 64)
  const configBuffer = device.createBuffer({
    label: "EventSpawn.config",
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Spawn counter buffer: [0]=totalSpawned, [1]=freeListConsumeIdx
  const spawnCounterBuffer = device.createBuffer({
    label: "EventSpawn.spawnCounter",
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  return {
    device,
    pipeline,
    shaderModule,
    configBuffer,
    spawnCounterBuffer,
    eventBindGroup: null,
    particleBindGroup: null,
    configBindGroup: null,
    _zeroCounters: new Uint32Array([0, 0]),
  };
}

/**
 * Initialize bind groups for the event spawn system
 * @param {Object} system - Event spawn system
 * @param {Object} world - Particle world (for event buffer + particle buffers)
 */
export function initEventSpawnBindGroups(system, world) {
  if (!system || !world || !system.device) return;
  const device = system.device;
  const indirectSystem = world.indirectSystem;

  if (!indirectSystem?.freeListBuffer || !indirectSystem?.counterBuffer) {
    console.warn('[EventSpawn] IndirectDispatch system with freeList required');
    return;
  }

  // Group 0: Event data + free list
  system.eventBindGroup = device.createBindGroup({
    label: "EventSpawn.eventBindGroup",
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: world.eventBuffer } },
      { binding: 1, resource: { buffer: world.eventCounterBuffer } },
      { binding: 2, resource: { buffer: indirectSystem.freeListBuffer } },
      { binding: 3, resource: { buffer: indirectSystem.counterBuffer } },
    ],
  });

  // Group 1: Particle output buffers
  system.particleBindGroup = device.createBindGroup({
    label: "EventSpawn.particleBindGroup",
    layout: system.pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: world.positionBuffer } },
      { binding: 1, resource: { buffer: world.velocityBuffer } },
      { binding: 2, resource: { buffer: world.metaBuffer } },
      { binding: 3, resource: { buffer: world.uvBuffer } },
      { binding: 4, resource: { buffer: world.thermalBuffer } },
    ],
  });

  // Group 2: Config + spawn counter + reaction table
  system.configBindGroup = device.createBindGroup({
    label: "EventSpawn.configBindGroup",
    layout: system.pipeline.getBindGroupLayout(2),
    entries: [
      { binding: 0, resource: { buffer: system.configBuffer } },
      { binding: 1, resource: { buffer: system.spawnCounterBuffer } },
      { binding: 2, resource: { buffer: world.reactionTableBuffer } },
    ],
  });
}

/**
 * Update sub-emitter spawn configuration
 * @param {Object} system
 * @param {Object} config
 */
export function setEventSpawnConfig(system, config = {}) {
  if (!system?.device) return;

  const subCount = Math.min(config.subCount ?? 4, MAX_SUB_PARTICLES_PER_EVENT);
  const eventMask = config.eventMask ?? 0xF; // All event types by default

  // Pack config into uniform buffer
  const data = new ArrayBuffer(64);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);

  u32[0] = subCount;                              // subCount
  f32[1] = config.inheritVelocity ?? 0.3;         // inheritVelocity
  f32[2] = config.speed ?? 2.0;                   // speed
  f32[3] = config.spread ?? 1.0;                  // spread
  f32[4] = config.lifetime ?? 0.5;                // lifetime
  f32[5] = config.size ?? 0.1;                    // size
  f32[6] = config.inheritTemperature ?? 0.5;      // inheritTemperature
  f32[7] = 0;                                     // _pad0
  f32[8] = config.color?.[0] ?? 1.0;              // color.r
  f32[9] = config.color?.[1] ?? 0.5;              // color.g
  f32[10] = config.color?.[2] ?? 0.0;             // color.b
  f32[11] = config.packedMetaW ?? 100000;          // packedMetaW (default: size=10, rm=0, shape=0, behavior=0)
  u32[12] = eventMask;                            // eventMask
  u32[13] = config.maxSpawnPerFrame ?? 512;        // maxSpawnPerFrame
  u32[14] = 0;                                    // _pad1
  u32[15] = 0;                                    // _pad2

  system.device.queue.writeBuffer(system.configBuffer, 0, new Uint8Array(data));
}

/**
 * Execute the event spawn compute pass
 * Call AFTER stepParticleSimWorld (events generated) and AFTER executeIndirectScan (free list built)
 * 
 * @param {GPUCommandEncoder} encoder
 * @param {Object} system
 * @param {Object} world - Particle world (for event count)
 */
export function executeEventSpawn(encoder, system, world) {
  if (!system?.eventBindGroup || !system?.particleBindGroup || !system?.configBindGroup) return;
  if (!world?.eventCounterBuffer) return;

  // Zero spawn counters
  system.device.queue.writeBuffer(system.spawnCounterBuffer, 0, system._zeroCounters);

  // Dispatch one workgroup per event (max = maxGpuEvents)
  // We dispatch the max possible; the shader early-outs for events beyond actual count
  const maxEvents = world.maxGpuEvents || 1024;

  const pass = encoder.beginComputePass({ label: "EventSpawn.computePass" });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.eventBindGroup);
  pass.setBindGroup(1, system.particleBindGroup);
  pass.setBindGroup(2, system.configBindGroup);
  pass.dispatchWorkgroups(maxEvents);
  pass.end();
}

/**
 * Destroy event spawn system
 */
export function destroyEventSpawnSystem(system) {
  if (!system) return;
  if (system.configBuffer) system.configBuffer.destroy();
  if (system.spawnCounterBuffer) system.spawnCounterBuffer.destroy();
  system.eventBindGroup = null;
  system.particleBindGroup = null;
  system.configBindGroup = null;
}
