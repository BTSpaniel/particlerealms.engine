// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createStorageBuffer, createUniformBuffer, updateBuffer, destroyBuffers } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { defineStruct, CommonStructs } from "../../core/gpu/WGSLStructLayout.js";
import { labelResource, withErrorScope } from "../../core/gpu/GpuDebug.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";
import { LEGACY_PARTICLE_RUNTIME_PCG_WGSL, LEGACY_PCG32_WGSL } from "../../core/math/MathBits.js";
import { DEFAULT_MAX_PARTICLES, PARTICLE_CONFIG, WORKGROUP_SIZES } from "./ParticleConfig.js";
import { LINE_COMPUTE_SHADER, LINE_RENDER_SHADER, CURL_NOISE_SNIPPET, MOUSE_INTERACTION_SNIPPET } from './ParticleEffects.js';
import {
  createGPUSortSystem, initSortBindGroup, executeGPUSort,
  createChunkedBufferSystem, destroyChunkedBufferSystem,
  createWireConstraintSystem, addWireConstraint, initWireBindGroup, solveWireConstraints,
  createSDFCollisionSystem, addSDFCollider, clearSDFColliders, rebuildSDFColliders, initSDFBindGroup, executeSDFCollision,
  createSeedingSystem, initSeedingBindGroup, seedParticlesGPU,
  createVolumetricLightingSystem, initVolumetricBindGroup, computeVolumetricLighting,
  createDepthCollisionSystem, initDepthCollisionBindGroup, executeDepthCollision,
} from './ParticleAdvanced.js';
import {
  createRadixSortSystem, initRadixSortBindGroups, executeRadixSort,
  destroyRadixSortSystem,
} from './ParticleRadixSort.js';
import {
  createRopeConstraintSystem, initRopeConstraintBindGroup, solveRopeConstraints,
  createRopeConstraints, addDistanceConstraint, addAttachmentConstraint,
  updateAttachmentTarget, clearRopeConstraints, destroyRopeConstraintSystem,
  THERMAL_MATERIAL_PRESETS,
} from './ParticleConstraints.js';
import {
  createTextureAtlasSystem, createProceduralAtlas, initAtlasBindGroup,
  assignSpritesGPU, setAssignmentMode, destroyTextureAtlasSystem,
} from './ParticleTextureAtlas.js';
import {
  createSnapshotSystem, initSnapshotBindGroups, autoSnapshot, takeSnapshot,
  restoreFrame, restoreInterpolated, seekToTime, startRewind, stopRewind,
  stepRewind, setPlaybackSpeed, getSnapshotInfo, clearHistory, destroySnapshotSystem,
} from './ParticleSnapshot.js';
import {
  createCustomEffectCollisionSystem, addCustomEffectCollider, updateCustomEffectCollider,
  initCustomEffectCollisionBindGroup, executeCustomEffectCollision,
  rebuildCustomEffectCollisionSystem, clearCustomEffectColliders, destroyCustomEffectCollisionSystem,
} from './CustomSDFCollisionBridge.js';
import {
  createBondSystem, stepBondSystem, destroyBondSystem,
} from './ParticleBonds.js';
import {
  createIndirectDispatchSystem, initIndirectDispatchBindGroups, executeIndirectScan,
  destroyIndirectDispatchSystem,
} from './ParticleIndirectDispatch.js';
import {
  createNoiseTextureSystem, bakeNoiseTexture, createDummyNoiseTexture,
  destroyNoiseTextureSystem,
} from './ParticleNoiseTexture.js';
import {
  createRibbonTrailSystem, initRibbonTrailBindGroups, updateTrailHistory,
  renderRibbonTrails, destroyRibbonTrailSystem,
} from './ParticleRibbonTrail.js';
import {
  initParticleEventSystem, stepEventSystem, destroyParticleEventSystem,
} from './ParticleEventSystem.js';
import {
  createSharedMemCollidePipeline, dispatchSharedMemCollide,
} from './ParticleSharedMemCollision.js';
import {
  createLifetimeCurvesSystem, setLifetimeCurves, destroyLifetimeCurvesSystem,
  curveFromLegacy3, CURVE_PRESETS,
} from './ParticleLifetimeCurves.js';
import {
  createVectorFieldSystem, createVectorFieldTexture, generateProceduralVectorField, setVectorFieldParams,
  loadVectorFieldFromData, parseFGA, destroyVectorFieldSystem,
} from './ParticleVectorField.js';
import {
  createSDFAttractionSystem, addSDFAttractor, updateSDFAttractor,
  initSDFAttractionBindGroup, executeSDFAttraction,
  clearSDFAttractors, destroySDFAttractionSystem,
} from './ParticleSDFAttraction.js';
import {
  createEmitterLOD, evaluateEmitterLOD, evaluateEmitterLODByScreenSize,
  getCurrentLODTier, setForcedLODTier, DEFAULT_LOD_TIERS,
} from './ParticleEmitterLOD.js';
import {
  createAdaptiveSubstepController, computeAdaptiveSubsteps,
  estimateMaxSpeedCPU, resetAdaptiveSubsteps,
} from './ParticleAdaptiveSubstep.js';
import {
  createAttributeReader, refreshAttributeCache, readParticlePosition,
  readParticleVelocity, readParticleMeta, findNearestParticle,
  findParticlesInRadius, destroyAttributeReader,
} from './ParticleAttributeReader.js';
import {
  createDecalSpawner, feedCollisionEvents, updateDecals,
  getActiveDecals, getDecalCount, clearDecals, destroyDecalSpawner,
} from './ParticleDecalSpawner.js';
import {
  createAudioBridge, registerAudioCue, processAudioEvents,
  flushPendingAudio, setAudioListenerPos, destroyAudioBridge,
} from './ParticleAudioBridge.js';
import {
  createNeighborGridSystem, initNeighborGridBindGroups,
  buildNeighborGrid, getNeighborGridBuffers, destroyNeighborGridSystem,
} from './ParticleNeighborGrid.js';
import {
  createFlockingSystem, initFlockingBindGroups, setFlockingParams,
  executeFlocking, destroyFlockingSystem,
} from './ParticleFlocking.js';
import {
  createSplineFollowSystem, setSplineControlPoints, initSplineFollowBindGroups,
  setSplineFollowParams, executeSplineFollow, destroySplineFollowSystem,
} from './ParticleSplineFollow.js';
import {
  createSurfaceProjectionSystem, addProjectionSurface, initProjectionBindGroups,
  executeSurfaceProjection, clearProjectionSurfaces, destroySurfaceProjectionSystem,
} from './ParticleSurfaceProjection.js';
import {
  createLocalSpaceSystem, initLocalSpaceBindGroups, setEmitterTransform,
  setEmitterTransformFromPosRot, executeWorldToLocal, executeLocalToWorld,
  destroyLocalSpaceSystem,
} from './ParticleLocalSpace.js';
import {
  createSoftContainmentSystem, addContainmentVolume, initContainmentBindGroups,
  executeSoftContainment, clearContainmentVolumes, destroySoftContainmentSystem,
} from './ParticleSoftContainment.js';
import {
  createEulerianFluidSolver, initFluidBindGroups, addFluidSource,
  stepEulerianFluid, destroyEulerianFluidSolver,
} from './ParticleEulerianFluid.js';
import {
  createElementTable, setParticleElements, setParticleCharges,
  destroyElementTable, getElement, getElementBySymbol, ELEMENTS,
  MOLECULE_PRESETS, ljMixingRule, ELEMENT_LUT_WGSL,
} from './ParticleElementTable.js';
import {
  createLennardJonesSystem, initLJBindGroups,
  executeLennardJones, destroyLennardJonesSystem,
} from './ParticleLennardJones.js';
import {
  createElectromagneticSystem, initEMBindGroups, setExternalField,
  executeElectromagnetic, destroyElectromagneticSystem,
} from './ParticleElectromagnetic.js';
import {
  createSPHSystem, initSPHBindGroups, setSPHParams,
  executeSPH, getSPHDensityBuffer, destroySPHSystem,
} from './ParticleSPH.js';
import {
  createNBodySystem, initNBodyBindGroups, setNBodyParams,
  executeNBody, destroyNBodySystem,
} from './ParticleNBody.js';
import {
  createFmmSystem, initFmmBindGroups, setFmmParams,
  executeFmm, readFmmDiagnostics, destroyFmmSystem,
} from './ParticleFMM.js';
import {
  createParticleMeshEwaldSystem, initParticleMeshEwaldBindGroups,
  setParticleMeshEwaldParams, executeParticleMeshEwald,
  readParticleMeshEwaldDiagnostics, destroyParticleMeshEwaldSystem,
} from './ParticleMeshEwald.js';
import {
  createChemistrySystem, initChemistryBindGroups, initParticleValence,
  executeChemistry, getValenceBuffer, destroyChemistrySystem,
} from './ParticleChemistry.js';
import {
  createRopeInteractionSystem, registerRopeForInteraction, unregisterRopeInteraction,
  stepRopeInteraction, getRopeInteractionState, destroyRopeInteractionSystem,
} from './RopeParticleInteraction.js';
import {
  createClassifierSystem, initClassifierBindGroups, executeClassifier,
  getClassificationBuffer, setClassifierParams, destroyClassifierSystem,
} from './ParticleClassifier.js';

function normalizePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n | 0;
}

function normalizeWorkgroupSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  const i = n | 0;
  if (i <= 0) {
    return fallback;
  }
  return i;
}
const PARTICLE_STRIDE_FLOATS = 4; // vec4<f32>
const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE_FLOATS * 4;
const MAX_GPU_COLLIDERS = 64;
const COLLIDER_STRIDE_FLOATS = 8; // 2 * vec4<f32> per collider (min, max)
const COLLIDER_STRIDE_BYTES = COLLIDER_STRIDE_FLOATS * 4;

// Use WGSLStructLayout for automatic buffer sizing
const ParamsLayout = CommonStructs.Params;
const FluidParamsLayout = CommonStructs.FluidParams;
const PARAMS_BUFFER_SIZE = ParamsLayout.layout.size;
const FLUID_PARAMS_BUFFER_SIZE = FluidParamsLayout.layout.size;

const OWNER_LOCAL_BITS = 16;
const OWNER_LOCAL_MASK = (1 << OWNER_LOCAL_BITS) - 1;
const OWNER_ID_SHIFT = OWNER_LOCAL_BITS;

function createParticleComputeShader(workgroupSize) {
  const size = normalizeWorkgroupSize(workgroupSize, 256);
  return `
struct Params {
  dt: f32,
  particleCount: u32,
  roomHalfSize: f32,
  gravityY: f32,
  baseIndex: u32,
  gridDims: u32,
  cellCap: u32,
  ropeSkip: u32,
  frameSeed: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct FluidParams {
  gridSize: vec3<f32>,
  fluidEnabled: f32,
  worldMin: vec3<f32>,
  _pad0: f32,
  worldMax: vec3<f32>,
  fluidInfluence: f32,
};

@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;
@group(0) @binding(3) var<storage, read> colliderBuffer : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> colliderParams : vec4<f32>;
@group(0) @binding(5) var<storage, read> particleMeta : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> thermalData : array<vec4<f32>>;

@group(1) @binding(0) var<storage, read> fluidVelocity : array<vec4<f32>>;
@group(1) @binding(1) var<uniform> fluidParams : FluidParams;

struct ForceParams {
  windDir: vec3<f32>,
  windStrength: f32,
  gustPhase: f32,
  gustStrength: f32,
  turbulenceStrength: f32,
  turbulenceScale: f32,
  turbulenceSpeed: f32,
  turbulenceOctaves: u32,
  forcePointCount: u32,
  maxVelocity: f32,
  vortexPos: vec3<f32>,
  vortexStrength: f32,
  vortexAxis: vec3<f32>,
  vortexRadius: f32,
  sizeGravityScale: f32,
  sortFrameInterval: u32,
  _fpPad0: u32,
  _fpPad1: u32,
};

@group(2) @binding(0) var<uniform> forceParams : ForceParams;
@group(2) @binding(1) var<uniform> forcePoints : array<vec4<f32>, 16>;
// Kill zones: [0]=vec4(count,0,0,0), then pairs of vec4 per zone (up to 4 zones)
// Zone pair: vec4(centerX, centerY, centerZ, type), vec4(param0, param1, param2, invert)
// type: 1=box, 2=sphere, 3=plane
@group(2) @binding(2) var<uniform> killZoneData : array<vec4<f32>, 10>;
// Event buffer: GPU-driven event generation (death, collision, kill zone, reaction)
// Event slot [i*2+0]: vec4(posX, posY, posZ, eventType)  — type: 1=death, 2=groundCollision, 3=entityCollision, 4=killZone, 5=reaction
// Event slot [i*2+1]: vec4(velX, velY, velZ, temperature)  — for type 5: w = reactionRuleIndex
@group(2) @binding(3) var<storage, read_write> eventBuffer : array<vec4<f32>>;
@group(2) @binding(4) var<storage, read_write> eventCounter : array<atomic<u32>>;
// eventCounter[0] = eventCount, eventCounter[1] = maxEvents

// Reaction table: cross-emitter particle reactions (substance A + substance B → product)
// Header: vec4<u32>(reactionCount, 0, 0, 0)
// Rules[i]: vec4<u32>(matA, matB, productMat, spawnCount),
//           vec4<f32>(colorR, colorG, colorB, energyRelease),
//           vec4<f32>(productTemp, productSize, productLifetime, flags)
// flags: bit0=killA, bit1=killB, bit2=spawnProduct
struct ReactionRule {
  matA: u32, matB: u32, productMat: u32, spawnCount: u32,
  productColor: vec3<f32>, energyRelease: f32,
  productTemp: f32, productSize: f32, productLifetime: f32, flags: u32,
};
struct ReactionTable {
  count: u32, _pad0: u32, _pad1: u32, _pad2: u32,
  rules: array<ReactionRule, 32>,
};
@group(2) @binding(5) var<uniform> reactionTable : ReactionTable;

// 3D noise texture for turbulence (pre-baked tileable curl noise volume)
// noiseParams: x=uvScale (1/period), y=enabled (>0 to use texture, 0 for computed fallback)
@group(3) @binding(0) var noiseVolume: texture_3d<f32>;
@group(3) @binding(1) var noiseSampler: sampler;
@group(3) @binding(2) var<uniform> noiseParams: vec4<f32>;

// Alive list: compact array of alive particle indices (built by scan pass)
// aliveCounters[0] = aliveCount (0 = disabled, use direct slot indexing)
@group(3) @binding(3) var<storage, read> aliveList: array<u32>;
@group(3) @binding(4) var<storage, read> aliveCounters: array<u32>;

// Vector field (GAP 11): 3D velocity texture for artistic particle motion control
// vfParams: vec4(centerX, centerY, centerZ, halfExtent), vec4(strength, tiling, scroll, enabled)
@group(3) @binding(5) var vectorFieldVolume: texture_3d<f32>;
@group(3) @binding(6) var vectorFieldSampler: sampler;
@group(3) @binding(7) var<uniform> vfParams: array<vec4<f32>, 2>;

// Sample vector field velocity at world position via trilinear interpolation
fn sampleVectorFieldVelocity(worldPos: vec3<f32>, time: f32) -> vec3<f32> {
  if (vfParams[1].w < 0.5) { return vec3<f32>(0.0); } // disabled
  let center = vfParams[0].xyz;
  let halfExt = vfParams[0].w;
  let strength = vfParams[1].x;
  let tiling = vfParams[1].y;
  let scroll = vfParams[1].z;
  // Normalize world position to [0,1] within field bounds
  let normalized = (worldPos - center + halfExt) / (2.0 * halfExt);
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return vec3<f32>(0.0);
  }
  let uv = normalized * tiling + vec3<f32>(scroll * time, 0.0, 0.0);
  let vel = textureSampleLevel(vectorFieldVolume, vectorFieldSampler, uv, 0.0).xyz;
  return vel * strength;
}

// Behavior constants
const BEHAVIOR_TRAIL: u32 = 0u;     // Follow velocity direction
const BEHAVIOR_ORBITAL: u32 = 1u;   // Circle around emitter origin
const BEHAVIOR_RISING: u32 = 2u;    // Float upward with swirl
const BEHAVIOR_SPIRAL: u32 = 3u;    // Spiral inward toward center
const BEHAVIOR_EXPLOSION: u32 = 4u; // Radiate outward from center
const BEHAVIOR_WIND: u32 = 5u;      // Affected by external wind force

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_RUNTIME_PCG_WGSL}

// Emit a particle event to the GPU event buffer (atomic append)
// eventType: 1=death, 2=groundCollision, 3=entityCollision, 4=killZone
fn emitEvent(position: vec3<f32>, velocity: vec3<f32>, eventType: f32, temperature: f32) {
  let maxEvents = atomicLoad(&eventCounter[1]);
  let idx = atomicAdd(&eventCounter[0], 1u);
  if (idx >= maxEvents) { return; }
  let base = idx * 2u;
  eventBuffer[base + 0u] = vec4<f32>(position, eventType);
  eventBuffer[base + 1u] = vec4<f32>(velocity, temperature);
}

// Deterministic scalar hash from integer-valued vec3 (replaces fract-chain hash)
fn hash(p: vec3<f32>) -> f32 {
  let seed = pcg_hash(bitcast<u32>(p.x) + pcg_hash(bitcast<u32>(p.y) + pcg_hash(bitcast<u32>(p.z))));
  return f32(seed) / 4294967295.0;
}

// 3D noise function for flow field
fn noise3d(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(
      mix(hash(i), hash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
      mix(hash(i + vec3<f32>(0.0, 1.0, 0.0)), hash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(hash(i + vec3<f32>(0.0, 0.0, 1.0)), hash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
      mix(hash(i + vec3<f32>(0.0, 1.0, 1.0)), hash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  ) * 2.0 - 1.0;
}

// Get fluid velocity at grid cell (clamped)
fn getFluidVelAt(cx: i32, cy: i32, cz: i32, gx: i32, gy: i32, gz: i32) -> vec3<f32> {
  let x = clamp(cx, 0, gx - 1);
  let y = clamp(cy, 0, gy - 1);
  let z = clamp(cz, 0, gz - 1);
  let idx = z * gx * gy + y * gx + x;
  return fluidVelocity[idx].xyz;
}

// Sample fluid velocity at world position using trilinear interpolation
fn sampleFluidVelocity(worldPos: vec3<f32>) -> vec3<f32> {
  if (fluidParams.fluidEnabled < 0.5) {
    return vec3<f32>(0.0);
  }
  
  let gridSize = fluidParams.gridSize;
  let worldMin = fluidParams.worldMin;
  let worldMax = fluidParams.worldMax;
  let volumeSize = worldMax - worldMin;
  
  // Normalize position to [0,1]
  let normalized = (worldPos - worldMin) / volumeSize;
  
  // Out of bounds check
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return vec3<f32>(0.0);
  }
  
  // Grid coordinates
  let gridPos = normalized * gridSize - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);
  
  let gx = i32(gridSize.x);
  let gy = i32(gridSize.y);
  let gz = i32(gridSize.z);
  
  // Trilinear interpolation
  let v000 = getFluidVelAt(cellMin.x, cellMin.y, cellMin.z, gx, gy, gz);
  let v100 = getFluidVelAt(cellMin.x + 1, cellMin.y, cellMin.z, gx, gy, gz);
  let v010 = getFluidVelAt(cellMin.x, cellMin.y + 1, cellMin.z, gx, gy, gz);
  let v110 = getFluidVelAt(cellMin.x + 1, cellMin.y + 1, cellMin.z, gx, gy, gz);
  let v001 = getFluidVelAt(cellMin.x, cellMin.y, cellMin.z + 1, gx, gy, gz);
  let v101 = getFluidVelAt(cellMin.x + 1, cellMin.y, cellMin.z + 1, gx, gy, gz);
  let v011 = getFluidVelAt(cellMin.x, cellMin.y + 1, cellMin.z + 1, gx, gy, gz);
  let v111 = getFluidVelAt(cellMin.x + 1, cellMin.y + 1, cellMin.z + 1, gx, gy, gz);
  
  let v00 = mix(v000, v100, f.x);
  let v10 = mix(v010, v110, f.x);
  let v01 = mix(v001, v101, f.x);
  let v11 = mix(v011, v111, f.x);
  
  let v0 = mix(v00, v10, f.y);
  let v1 = mix(v01, v11, f.y);
  
  return mix(v0, v1, f.z);
}

// Extract behavior from packed meta.w value
// Packing: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
fn extractBehavior(metaW: f32) -> u32 {
  return u32(metaW) % 10u;
}

// Calculate behavior-based force for a particle
fn calculateBehaviorForce(
  behavior: u32,
  pos: vec3<f32>,
  vel: vec3<f32>,
  age: f32,
  dt: f32
) -> vec3<f32> {
  var force = vec3<f32>(0.0);
  
  switch (behavior) {
    case BEHAVIOR_TRAIL: {
      // Trail: particles follow their velocity, slight drag
      // No additional force needed, just use existing velocity
    }
    case BEHAVIOR_ORBITAL: {
      // Orbital: circle around origin in XZ plane
      let toCenter = -pos;
      let dist = length(toCenter.xz);
      if (dist > 0.1) {
        let tangent = normalize(vec3<f32>(-toCenter.z, 0.0, toCenter.x));
        let orbitSpeed = 3.0;
        let centripetal = normalize(vec3<f32>(toCenter.x, 0.0, toCenter.z)) * 2.0;
        force = tangent * orbitSpeed + centripetal;
      }
    }
    case BEHAVIOR_RISING: {
      // Rising: float upward with gentle swirl
      force.y = 2.0;
      let swirlAngle = age * 2.0 + pos.y * 0.5;
      force.x = sin(swirlAngle) * 0.5;
      force.z = cos(swirlAngle) * 0.5;
    }
    case BEHAVIOR_SPIRAL: {
      // Spiral: move inward while rotating
      let toCenter = -pos;
      let dist = length(toCenter);
      if (dist > 0.1) {
        let inward = normalize(toCenter) * 1.5;
        let tangent = normalize(vec3<f32>(-toCenter.z, toCenter.y * 0.5, toCenter.x));
        force = inward + tangent * 2.0;
      }
    }
    case BEHAVIOR_EXPLOSION: {
      // Explosion: radiate outward from center
      let fromCenter = pos;
      let dist = length(fromCenter);
      if (dist > 0.01) {
        force = normalize(fromCenter) * 5.0 * exp(-age * 2.0);
      }
    }
    case BEHAVIOR_WIND: {
      // Wind behavior: extra sensitivity to global wind (2x multiplier)
      let gustMod = 1.0 + sin(forceParams.gustPhase + pos.x * 0.1) * forceParams.gustStrength;
      force = forceParams.windDir * forceParams.windStrength * gustMod * 2.0;
    }
    default: {
      // Default: no extra force
    }
  }
  
  return force;
}

// ============================================================================
// PARTICLE SHAPE SDFs - For accurate particle-to-particle collision
// Shape: 0=sphere, 1=point, 2=soft/smoke, 3=spark, 4=ring, 5=beam, 6=rune, 7=mist, 8=halo
// ============================================================================

fn sdSpherePtcl(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sdTorusPtcl(p: vec3<f32>, major: f32, minor: f32) -> f32 {
    let q = vec2<f32>(length(p.xz) - major, p.y);
    return length(q) - minor;
}

fn sdCrossPtcl(p: vec3<f32>, size: f32, thick: f32) -> f32 {
    let ax = abs(p.x);
    let ay = abs(p.y);
    let cross2d = min(ax, ay) - thick;
    let bounded = max(max(ax, ay) - size, abs(p.z) - thick);
    return max(cross2d, bounded);
}

fn sdCylinderPtcl(p: vec3<f32>, h: f32, r: f32) -> f32 {
    let d = abs(vec2<f32>(length(p.xz), p.y)) - vec2<f32>(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

fn sminPtcl(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

// Evaluate particle shape SDF at local position
// Returns signed distance (negative = inside shape)
fn particleShapeSDF(localPos: vec3<f32>, shape: u32, radius: f32, age: f32) -> f32 {
    let p = localPos / radius;  // Normalize to unit space
    
    switch(shape) {
        // Shape 0: SPHERE - solid ball
        case 0u: {
            return sdSpherePtcl(p, 1.0) * radius;
        }
        // Shape 1: POINT - tiny concentrated dot (smaller collision)
        case 1u: {
            return sdSpherePtcl(p, 0.5) * radius;
        }
        // Shape 2: SOFT/SMOKE - organic blob (use sphere approx for perf)
        case 2u: {
            return sdSpherePtcl(p, 1.2) * radius;
        }
        // Shape 3: SPARK/STAR - cross shape with center
        case 3u: {
            let cross = sdCrossPtcl(p, 1.0, 0.3);
            let sphere = sdSpherePtcl(p, 0.5);
            return sminPtcl(cross, sphere, 0.2) * radius;
        }
        // Shape 4: RING - hollow torus (particles can pass through center!)
        case 4u: {
            return sdTorusPtcl(p, 0.6, 0.2) * radius;
        }
        // Shape 5: BEAM - vertical column
        case 5u: {
            return sdCylinderPtcl(p, 1.0, 0.3) * radius;
        }
        // Shape 6: RUNE - circle + cross glyph
        case 6u: {
            let circle = sdTorusPtcl(p, 0.85, 0.1);
            let cross = sdCrossPtcl(p, 0.7, 0.1);
            return min(circle, cross) * radius;
        }
        // Shape 7: MIST/FOG - large soft blob
        case 7u: {
            return sdSpherePtcl(p, 1.4) * radius;
        }
        // Shape 8: HALO - ring with soft glow
        case 8u: {
            let ring = sdTorusPtcl(p, 0.7, 0.15);
            let glow = sdSpherePtcl(p, 0.9);
            return sminPtcl(ring, glow, 0.3) * radius;
        }
        // Default: sphere
        default: {
            return sdSpherePtcl(p, 1.0) * radius;
        }
    }
}

// Get collision radius with age animation
fn getParticleRadius(sizeEncoded: f32, shape: u32, age: f32, lifetime: f32) -> f32 {
    let baseRadius = max(0.05, sizeEncoded * 0.5);
    
    // Age-based size animation (matches vertex shader)
    let t = clamp(age / max(lifetime, 0.1), 0.0, 1.0);
    let fadeIn = smoothstep(0.0, 0.08, t);
    let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
    let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
    
    // Shape-specific scale
    var shapeScale = 1.0;
    switch(shape) {
        case 1u: { shapeScale = 0.5; }  // Point
        case 2u: { shapeScale = 0.8; }  // Soft
        case 4u: { shapeScale = 0.6; }  // Ring (hollow)
        case 7u: { shapeScale = 0.7; }  // Mist
        default: { shapeScale = 1.0; }
    }
    
    return baseRadius * sizeFactor * shapeScale * 0.85;  // 15% depth blend offset
}

// Extract mass from packed meta.w
fn extractParticleMass(packedMeta: f32) -> f32 {
    let massEncoded = floor(packedMeta / 1e8) % 100.0;
    return max(0.1, massEncoded * 0.1);  // 0.1 to 9.9 range
}

// Check if particle should skip collision (sleeping/LOD)
fn isParticleSleeping(speed: f32, lifeRatio: f32) -> bool {
    return (speed < 0.01 && lifeRatio > 0.8);
}

fn isParticleNearDeath(lifeRatio: f32) -> bool {
    return lifeRatio > 0.95;
}

// ============================================================================
// CURL NOISE - Turbulence for organic collision response
// ============================================================================

fn hash33(p: vec3<f32>) -> vec3<f32> {
    let seed = pcg_hash(bitcast<u32>(p.x) + pcg_hash(bitcast<u32>(p.y) + pcg_hash(bitcast<u32>(p.z))));
    return vec3<f32>(
        f32(pcg_hash(seed      )) / 4294967295.0 * 2.0 - 1.0,
        f32(pcg_hash(seed + 1u )) / 4294967295.0 * 2.0 - 1.0,
        f32(pcg_hash(seed + 2u )) / 4294967295.0 * 2.0 - 1.0,
    );
}

fn gradientNoise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(mix(dot(hash33(i + vec3<f32>(0.0, 0.0, 0.0)), f - vec3<f32>(0.0, 0.0, 0.0)),
                dot(hash33(i + vec3<f32>(1.0, 0.0, 0.0)), f - vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(dot(hash33(i + vec3<f32>(0.0, 1.0, 0.0)), f - vec3<f32>(0.0, 1.0, 0.0)),
                dot(hash33(i + vec3<f32>(1.0, 1.0, 0.0)), f - vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(dot(hash33(i + vec3<f32>(0.0, 0.0, 1.0)), f - vec3<f32>(0.0, 0.0, 1.0)),
                dot(hash33(i + vec3<f32>(1.0, 0.0, 1.0)), f - vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(dot(hash33(i + vec3<f32>(0.0, 1.0, 1.0)), f - vec3<f32>(0.0, 1.0, 1.0)),
                dot(hash33(i + vec3<f32>(1.0, 1.0, 1.0)), f - vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

fn vectorPotentialComputed(p: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        gradientNoise(p + vec3<f32>(19.19, 73.73, 41.41)),
        gradientNoise(p + vec3<f32>(-37.17, 11.31, 97.97)),
        gradientNoise(p + vec3<f32>(83.83, -53.53, 29.29))
    );
}

fn curlNoiseOctaveComputed(p: vec3<f32>) -> vec3<f32> {
    let e = 0.1;
    let dx = vec3<f32>(e, 0.0, 0.0);
    let dy = vec3<f32>(0.0, e, 0.0);
    let dz = vec3<f32>(0.0, 0.0, e);
    
    let a_x0 = vectorPotentialComputed(p - dx);
    let a_x1 = vectorPotentialComputed(p + dx);
    let a_y0 = vectorPotentialComputed(p - dy);
    let a_y1 = vectorPotentialComputed(p + dy);
    let a_z0 = vectorPotentialComputed(p - dz);
    let a_z1 = vectorPotentialComputed(p + dz);
    
    return vec3<f32>(
        (a_y1.z - a_y0.z) - (a_z1.y - a_z0.y),
        (a_z1.x - a_z0.x) - (a_x1.z - a_x0.z),
        (a_x1.y - a_x0.y) - (a_y1.x - a_y0.x)
    ) / (2.0 * e) * 0.57735026919;
}

fn curlNoiseOctave(p: vec3<f32>) -> vec3<f32> {
    // When 3D noise texture is baked, sample it (1 texture lookup vs 6 gradientNoise calls)
    if (noiseParams.y > 0.5) {
        return textureSampleLevel(noiseVolume, noiseSampler, p * noiseParams.x, 0.0).xyz;
    }
    return curlNoiseOctaveComputed(p);
}

fn curlNoise(p: vec3<f32>, time: f32) -> vec3<f32> {
    let pt = p + vec3<f32>(time * 0.1, 0.0, 0.0);
    return curlNoiseOctave(pt);
}

fn curlNoiseFBM(p: vec3<f32>, time: f32, octaves: u32) -> vec3<f32> {
    let pt = p + vec3<f32>(time * 0.1, 0.0, 0.0);
    // When noise texture is available, resolution-appropriate FBM is pre-baked.
    if (noiseParams.y > 0.5) {
        return textureSampleLevel(noiseVolume, noiseSampler, pt * noiseParams.x, 0.0).xyz;
    }
    // Computed fallback: loop over octaves
    var result = vec3<f32>(0.0);
    var freq = 1.0;
    var amp = 1.0;
    let oct = clamp(octaves, 1u, 4u);
    for (var o = 0u; o < oct; o++) {
        result += curlNoiseOctaveComputed(pt * freq) * amp;
        freq *= 2.0;
        amp *= 0.5;
    }
    return result;
}

// ============================================================================
// VORTEX FORCE - Spinning force around collision normal
// ============================================================================

fn vortexForce(pos: vec3<f32>, normal: vec3<f32>, strength: f32) -> vec3<f32> {
    // Create tangent vector perpendicular to normal
    var tangent = cross(normal, vec3<f32>(0.0, 1.0, 0.0));
    if (length(tangent) < 0.01) {
        tangent = cross(normal, vec3<f32>(1.0, 0.0, 0.0));
    }
    tangent = normalize(tangent);
    return tangent * strength;
}

// ============================================================================
// SPECULATIVE CONTACTS - Predict future collisions
// ============================================================================

fn predictCollisionTime(pos: vec3<f32>, vel: vec3<f32>, otherPos: vec3<f32>, combinedRadius: f32, maxTime: f32) -> f32 {
    let relPos = pos - otherPos;
    let relVel = vel;  // Assuming other is stationary for simplicity
    
    // Quadratic: |relPos + t*relVel|² = combinedRadius²
    let a = dot(relVel, relVel);
    let b = 2.0 * dot(relPos, relVel);
    let c = dot(relPos, relPos) - combinedRadius * combinedRadius;
    
    let discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0 || a < 0.0001) {
        return maxTime + 1.0;  // No collision
    }
    
    let t = (-b - sqrt(discriminant)) / (2.0 * a);
    if (t < 0.0) {
        return maxTime + 1.0;  // Collision in past
    }
    return t;
}

// ============================================================================
// ANGULAR VELOCITY - For non-spherical shapes
// ============================================================================

fn computeAngularResponse(
    shape: u32,
    collisionNormal: vec3<f32>,
    relativeVel: vec3<f32>,
    penetration: f32
) -> vec3<f32> {
    // Non-spherical shapes get angular impulse on collision
    // This creates spinning/tumbling behavior
    if (shape == 0u || shape == 1u) {
        return vec3<f32>(0.0);  // Spheres don't spin from collision
    }
    
    // Cross product gives rotation axis
    let rotationAxis = cross(collisionNormal, relativeVel);
    let angularStrength = length(relativeVel) * penetration * 0.1;
    
    return normalize(rotationAxis + vec3<f32>(0.001)) * angularStrength;
}

@compute @workgroup_size(${size})
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let threadIdx = global_id.x;

  // Alive list indirection: when enabled, gid.x indexes into compact alive list
  // When disabled (aliveCounters[0] == 0), fall back to direct slot indexing
  let aliveCount = aliveCounters[0];
  var i: u32;
  if (aliveCount > 0u) {
    if (threadIdx >= aliveCount) { return; }
    i = aliveList[threadIdx];
  } else {
    if (threadIdx >= params.particleCount) { return; }
    i = threadIdx + params.baseIndex;
  }

  var pos = positions[i];
  var vel = velocities[i];

  let dt = params.dt;
  let g = params.gravityY;

  // Per-particle deterministic seed from collab-synced frameSeed
  // Ensures identical GPU RNG sequences across all peers
  var pSeed = pcg_hash(params.frameSeed + i);

  // Particle age in seconds. Lifespan is controlled by per-particle
  // lifetime in the render shaders, so we do not clamp age here.
  var age = pos.w + dt;

  // Dead particle early-out: skip ALL forces/collisions/reactions for particles past lifetime
  let lifetime = vel.w;
  if (age >= lifetime) {
    // Emit death event exactly once (the frame age first crosses lifetime)
    let prevAge = age - dt;
    if (prevAge < lifetime) {
      emitEvent(pos.xyz, vel.xyz, 1.0, thermalData[i].x);
    }
    positions[i] = vec4<f32>(pos.xyz, age);
    return;
  }

  // Sample fluid velocity at current position and blend with particle velocity
  var velXYZ = vel.xyz;
  if (fluidParams.fluidEnabled > 0.5) {
    let fluidVel = sampleFluidVelocity(pos.xyz);
    velXYZ = mix(velXYZ, fluidVel, fluidParams.fluidInfluence * dt);
  }

  // Extract per-particle mass and drag from packed meta.w
  // Pack format: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
  let particle = particleMeta[i];
  let packedMeta = particle.w;
  let massEncoded = floor(packedMeta / 1e8) % 100.0;  // 0-99
  let dragEncoded = floor(packedMeta / 1e6) % 100.0;  // 0-99
  let mass = max(0.1, massEncoded * 0.1);  // Decode: 0.1 to 9.9
  let drag = dragEncoded * 0.01;           // Decode: 0.0 to 0.99
  let behavior = extractBehavior(packedMeta);
  
  // Read thermal data: [temperature, phase, packedGroupMaterial, latentEnergy]
  var thermal = thermalData[i];
  let temperature = thermal.x;   // Kelvin (293 = room temp)
  let particlePhase = thermal.y; // 0=solid, 1=liquid, 2=gas, 3=plasma
  // thermal.z packing: lower 8 bits = materialIdx, upper bits = groupId
  // thermal.w = latent energy accumulator (used by heat conduction shader)
  
  // Apply gravity scaled by mass (lighter = less affected)
  // Size-based gravity: bigger particles fall faster (sizeGravityScale > 0)
  let sizeEncoded = (floor(packedMeta / 1e4) % 100.0) * 0.1;
  let sizeGravMul = 1.0 + sizeEncoded * forceParams.sizeGravityScale;
  // Thermal buoyancy: hot gas/plasma particles get upward force
  let gravityAccel = g * mass * sizeGravMul;
  var buoyancy = 0.0;
  if (particlePhase >= 2.0 && temperature > 400.0) {
    // Gas/plasma: buoyancy proportional to temperature above 400K
    buoyancy = clamp((temperature - 400.0) * 0.005, 0.0, 10.0);
  }
  velXYZ.y = velXYZ.y + (gravityAccel + buoyancy) * dt;

  // ========== THERMAL FLUID PHYSICS (from Particle Storm / Thermal demo) ==========
  // Liquid phase: boiling turbulence + hot-water convection (CS_ICE_WATER pattern)
  let isLiquidThermal = (particlePhase >= 0.5 && particlePhase < 1.5);
  let isGasThermal    = (particlePhase >= 1.5 && particlePhase < 2.5);
  if (isLiquidThermal) {
    // Boiling turbulence: kicks in 55°C–95°C above melt (273K → ~330K–370K)
    // Normalized: boilFac 0 at 330K, 1 at 370K
    let boilFac = smoothstep(330.0, 370.0, temperature);
    if (boilFac > 0.001) {
      // x/z turbulence only (vertical handled by convection below) — matches CS_ICE_WATER
      // Use particle age as time seed (each particle has its own phase offset)
      let bx = sin(pos.x * 4.1 + age * 3.2 + pos.z * 2.7) * boilFac * 1.8;
      let bz = cos(pos.z * 3.8 + age * 2.9 + pos.x * 3.1) * boilFac * 1.8;
      velXYZ.x += bx * dt;
      velXYZ.z += bz * dt;
    }
    // Convection: hot water rises (temperature above 273K melt point)
    let convection = (temperature - 273.0) * 0.003 * (1.0 - boilFac * 0.5);
    velXYZ.y += convection * dt;
    // Nucleation: sparse near-boiling particles get upward kick (evaporation onset)
    let nucleate = smoothstep(355.0, 370.0, temperature) * boilFac;
    velXYZ.y += nucleate * 1.5 * dt;
  }
  // Steam/gas phase: tornado vortex + strong buoyancy (CS_ICE_WATER steamFac pattern)
  if (isGasThermal && temperature > 373.0) {
    // Vortex: hourglass shape — tighter at waist, wider at top/bottom
    let xz = vec2<f32>(pos.x, pos.z);
    let r = max(length(xz), 0.3);
    let nr = xz / r;
    // Waist factor: tightest at y=0, wider above/below
    let waist = exp(-pos.y * pos.y * 0.07);
    let tgtR = mix(3.8, 0.65, waist * waist);
    // Tangential spin + radial pull toward target radius
    let vortexStr = clamp((temperature - 373.0) * 0.004, 0.0, 1.0);
    velXYZ.x += (-nr.y * 2.2 + nr.x * (tgtR - r) * 1.8) * vortexStr * dt;
    velXYZ.z += ( nr.x * 2.2 + nr.y * (tgtR - r) * 1.8) * vortexStr * dt;
    // Strong updraft in the eye (r < 0.6), weaker outside
    velXYZ.y += vortexStr * 3.0 * clamp((0.6 - r) * 2.0, 0.0, 1.0) * dt;
    // Gentle downdraft at large radius (recirculation)
    velXYZ.y -= vortexStr * 1.2 * max(0.0, r - 3.5) * dt;
  }
  
  // Apply per-particle drag + age-based decay (older particles slow down more)
  // Phase-based drag modulation: gas=low drag, liquid=medium, solid=high
  let t = clamp(age / max(lifetime, 0.1), 0.0, 1.0);
  let phaseDragMod = select(1.0, select(0.7, 0.3, particlePhase >= 2.0), particlePhase >= 1.0);
  let totalDrag = (drag * phaseDragMod) + t * 0.03;  // Base drag * phase modifier + age decay
  let speed = length(velXYZ);
  if (speed > 0.01) {
    velXYZ = velXYZ * (1.0 - totalDrag * dt);
  }
  
  // Apply behavior-based forces (particle and behavior already extracted above)
  let behaviorForce = calculateBehaviorForce(behavior, pos.xyz, velXYZ, age, dt);
  velXYZ = velXYZ + behaviorForce * dt;
  
  // ========== GLOBAL WIND (relative force — converges toward wind velocity) ==========
  if (forceParams.windStrength > 0.001) {
    let gustMod = 1.0 + sin(forceParams.gustPhase + pos.x * 0.1 + pos.z * 0.07) * forceParams.gustStrength;
    let windTarget = forceParams.windDir * forceParams.windStrength * gustMod;
    // Phase-based wind sensitivity: gas/plasma > liquid > solid
    let windSensitivity = select(0.3, select(0.6, 1.0, particlePhase >= 2.0), particlePhase >= 1.0);
    let windForce = (windTarget - velXYZ) * 0.1 * windSensitivity;
    velXYZ += windForce * dt;
  }

  // ========== GLOBAL TURBULENCE (FBM curl noise field) ==========
  if (forceParams.turbulenceStrength > 0.001) {
    let turbPos = pos.xyz * forceParams.turbulenceScale + vec3<f32>(forceParams.turbulenceSpeed * age, 0.0, 0.0);
    let turbForce = curlNoiseFBM(turbPos, age, forceParams.turbulenceOctaves) * forceParams.turbulenceStrength;
    // Turbulence over lifetime: fade with age (young particles more affected)
    let turbLifeFactor = 1.0 - clamp(t * 0.5, 0.0, 0.8);
    velXYZ += turbForce * turbLifeFactor * dt;
  }

  // ========== FORCE POINTS (attractors/repellers) ==========
  for (var fp = 0u; fp < min(forceParams.forcePointCount, 16u); fp++) {
    let point = forcePoints[fp];
    let toPoint = point.xyz - pos.xyz;
    let dist2 = dot(toPoint, toPoint);
    if (dist2 > 0.01) {
      let dist = sqrt(dist2);
      let falloff = 1.0 / (dist2 + 0.5);
      velXYZ += normalize(toPoint) * point.w * falloff * dt; // .w = strength (negative = repel)
    }
  }

  // ========== VORTEX FORCE FIELD ==========
  if (abs(forceParams.vortexStrength) > 0.001) {
    let vAxis = normalize(forceParams.vortexAxis);
    let toCenter = pos.xyz - forceParams.vortexPos;
    let projected = toCenter - dot(toCenter, vAxis) * vAxis;
    let projDist = length(projected);
    if (projDist > 0.01) {
      let falloff = exp(-projDist / max(forceParams.vortexRadius, 0.1));
      let tangent = cross(vAxis, normalize(projected));
      velXYZ += tangent * forceParams.vortexStrength * falloff * dt;
    }
  }

  // ========== VECTOR FIELD (GAP 11: authored 3D flow field) ==========
  {
    let vfVel = sampleVectorFieldVelocity(pos.xyz, age);
    if (length(vfVel) > 0.001) {
      // Blend: converge toward field velocity (similar to wind)
      let vfForce = (vfVel - velXYZ) * 0.15;
      velXYZ += vfForce * dt;
    }
  }

  // ========== VELOCITY CLAMP (safety) ==========
  if (forceParams.maxVelocity > 0.0) {
    let spd = length(velXYZ);
    if (spd > forceParams.maxVelocity) {
      velXYZ = velXYZ * (forceParams.maxVelocity / spd);
    }
  }

  vel = vec4<f32>(velXYZ, vel.w);

  // Integrate position
  var newPos = pos.xyz + vel.xyz * dt;

  // ===== GROUND PLANE COLLISION (y = 0) =====
  // Phase-aware ground collision: liquid pools, solid bounces, gas ignores
  // Particle visual radius offset so spheres REST on ground (not center-at-ground)
  let isLiquidPhase = (particlePhase >= 0.5 && particlePhase < 1.5);
  let particleRadius = select(0.0, 0.15, isLiquidPhase); // liquid particles have visual radius
  let groundY = 0.0 + particleRadius;

  if (isLiquidPhase) {
    // LIQUID: Pool on ground — near-zero bounce, high friction, strong vertical damping
    // Also apply gentle boundary repulsion slightly above ground to prevent density gap
    let boundaryDist = newPos.y - 0.0;
    if (boundaryDist < 0.5 && boundaryDist > -0.5) {
      // Lennard-Jones style wall repulsion: prevents SPH density discontinuity at boundary
      let repulsionDist = max(boundaryDist, 0.02);
      let wallRepulsion = clamp(0.3 / (repulsionDist * repulsionDist) - 1.0, 0.0, 50.0);
      vel.y = vel.y + wallRepulsion * dt;
    }
    if (newPos.y < groundY) {
      newPos.y = groundY;
      let impactSpeed = abs(vel.y);
      if (vel.y < 0.0) {
        if (impactSpeed > 1.0) {
          emitEvent(newPos, vel.xyz, 2.0, thermal.x);
        }
        // Near-zero bounce for water — it pools, doesn't bounce
        vel.y = -vel.y * 0.02;
        // Minimal horizontal spread — water spreads via SPH pressure, not impact scatter
        let spreadAngle = noise3d(vec3<f32>(newPos.x * 0.5, newPos.z * 0.5, age)) * 6.28318;
        let spreadForce = impactSpeed * 0.08;
        vel.x = vel.x + cos(spreadAngle) * spreadForce;
        vel.z = vel.z + sin(spreadAngle) * spreadForce;
      }
      // Strong friction on ground for liquid — helps form puddles
      vel.x = vel.x * 0.85;
      vel.z = vel.z * 0.85;
      // Damp vertical velocity when near ground to prevent oscillation
      vel.y = vel.y * 0.7;
    }
  } else {
    // NON-LIQUID: Original behavior (solid bounces, gas/plasma mostly ignores)
    if (newPos.y < 0.0) {
      newPos.y = 0.0;
      let impactSpeed = abs(vel.y);
      if (vel.y < 0.0) {
        if (impactSpeed > 0.5) {
          emitEvent(newPos, vel.xyz, 2.0, thermal.x);
        }
        vel.y = -vel.y * 0.15;  // Small bounce
        let spreadAngle = noise3d(vec3<f32>(newPos.x * 0.5, newPos.z * 0.5, age)) * 6.28318;
        let spreadForce = impactSpeed * 0.4;
        vel.x = vel.x + cos(spreadAngle) * spreadForce;
        vel.z = vel.z + sin(spreadAngle) * spreadForce;
      }
      vel.x = vel.x * 0.9;  // Friction on ground
      vel.z = vel.z * 0.9;
    }
  }

  // Entity collider collisions
  let colliderCount = i32(colliderParams.x);
  for (var c: i32 = 0; c < colliderCount; c = c + 1) {
    let minVec = colliderBuffer[c * 2];
    let maxVec = colliderBuffer[c * 2 + 1];
    if (newPos.x >= minVec.x && newPos.x <= maxVec.x &&
        newPos.y >= minVec.y && newPos.y <= maxVec.y &&
        newPos.z >= minVec.z && newPos.z <= maxVec.z) {
      newPos.y = maxVec.y;
      // Spread horizontally on collision
      let hitSpeed = abs(vel.y);
      if (vel.y < 0.0) {
        // Emit entity collision event
        if (hitSpeed > 0.5) {
          emitEvent(newPos, vel.xyz, 3.0, thermal.x);
        }
        vel.y = -vel.y * 0.15;
        let angle = noise3d(vec3<f32>(newPos.x * 0.3, newPos.z * 0.3, age * 0.5)) * 6.28318;
        let spread = hitSpeed * 0.5;
        vel.x = vel.x + cos(angle) * spread;
        vel.z = vel.z + sin(angle) * spread;
      }
      vel.x = vel.x * 0.9;
      vel.z = vel.z * 0.9;
    }
  }

  // Noise-based flow field — only when fluid system is disabled (fallback turbulence)
  if (fluidParams.fluidEnabled < 0.5 && forceParams.turbulenceStrength < 0.001) {
    let noiseScale = 0.08;
    let noiseStrength = 0.4;
    let noiseZ = age * 0.1;
    let noiseVal = noise3d(vec3<f32>(newPos.x * noiseScale, newPos.z * noiseScale, noiseZ));
    let flowAngle = noiseVal * 3.14159 * 4.0;
    vel.x = vel.x + cos(flowAngle) * noiseStrength * dt;
    vel.z = vel.z + sin(flowAngle) * noiseStrength * dt;
  }
  
  // Particle-particle collisions using full SDF shape evaluation
  // Shapes like rings let particles pass through their center, stars collide on arms
  // Enhanced with: mass-weighting, proper friction, sleeping/LOD, CCD
  // SKIP for liquid particles: SPH handles all inter-particle forces (pressure, viscosity, surface tension)
  let local = i - params.baseIndex;
  if (params._pad0 == 0u && !isLiquidPhase) {
    // Extract this particle's properties
    let mySizeEncoded = (floor(packedMeta / 1e4) % 100.0) * 0.1;
    let myShape = u32(floor(packedMeta / 10.0)) % 10u;
    let myRadius = getParticleRadius(mySizeEncoded, myShape, age, lifetime);
    let myMass = extractParticleMass(packedMeta);
    let myInvMass = 1.0 / myMass;
    let mySpeed = length(vel.xyz);
    let myLifeRatio = age / max(lifetime, 0.1);
    
    // ========== SLEEPING/LOD OPTIMIZATION ==========
    // Skip collision for particles near death or sleeping
    if (isParticleNearDeath(myLifeRatio)) {
      // Near death - skip particle-particle collision
    } else {
      let mySleeping = isParticleSleeping(mySpeed, myLifeRatio);
      
      // Broad phase: max possible collision distance
      let broadPhaseRadius = myRadius * 3.0;
      var separationForce = vec3<f32>(0.0);
      var positionCorrection = vec3<f32>(0.0);
      let samples = select(8u, 4u, mySleeping);  // Fewer samples for sleeping particles
      let particleCount = params.particleCount;
      let myGroup = u32(thermal.z) >> 8u;
      let myMat = u32(thermal.z) & 0xFFu;
      var hadCollision = false;
      
      // ========== CCD: Previous position for fast particles ==========
      let prevPos = newPos - vel.xyz * dt;
      let useCCD = (mySpeed * dt > myRadius * 0.5);
      
      for (var s: u32 = 0u; s < samples; s = s + 1u) {
        let jLocal = (local + (s * 7919u + 104729u)) % particleCount;
        if (jLocal == local) { continue; }
        let j = params.baseIndex + jLocal;
        
        let otherPos = positions[j].xyz;
        
        // Cheap broad phase first — skip heavy calculations for distant particles
        let offset = newPos - otherPos;
        let d2 = dot(offset, offset);
        // Use conservative max radius for early rejection (avoids getParticleRadius)
        let maxDistConservative = broadPhaseRadius + broadPhaseRadius;
        if (d2 > maxDistConservative * maxDistConservative || d2 < 0.0001) { continue; }
        
        // Passed broad phase — now extract expensive per-neighbor properties
        let otherVel = velocities[j].xyz;
        let otherAge = positions[j].w;
        let otherLifetime = velocities[j].w;
        let otherLifeRatio = otherAge / max(otherLifetime, 0.1);
        
        // Skip if other is near death
        if (isParticleNearDeath(otherLifeRatio)) { continue; }
        
        // ========== COLLISION GROUP FILTERING ==========
        // thermal.z packing: lower 8 bits = materialIdx, upper bits = groupId
        // Group 0 = collides with everything. Same non-zero group = skip collision.
        let otherGroup = u32(thermalData[j].z) >> 8u;
        if (myGroup != 0u && myGroup == otherGroup) { continue; }
        
        let otherMeta = particleMeta[j];
        let otherSizeEncoded = (floor(otherMeta.w / 1e4) % 100.0) * 0.1;
        let otherShape = u32(floor(otherMeta.w / 10.0)) % 10u;
        let otherRadius = getParticleRadius(otherSizeEncoded, otherShape, otherAge, otherLifetime);
        let otherMass = extractParticleMass(otherMeta.w);
        
        // Refined broad phase with actual radius
        let maxDist = broadPhaseRadius + otherRadius * 3.0;
        if (d2 > maxDist * maxDist) { continue; }
        
        let dist = sqrt(d2);
        let dir = offset / dist;
        
        // ========== CCD: Check along motion path for fast particles ==========
        var effectiveDist = dist - myRadius - otherRadius;
        if (useCCD) {
          // Sample along motion path
          for (var ccdStep = 0u; ccdStep < 3u; ccdStep++) {
            let t = f32(ccdStep) / 2.0;
            let samplePos = mix(prevPos, newPos, t);
            let sampleOffset = samplePos - otherPos;
            let sampleDist = length(sampleOffset) - myRadius - otherRadius;
            effectiveDist = min(effectiveDist, sampleDist);
          }
        }
        
        // ========== NARROW PHASE: Full SDF shape collision ==========
        if (!mySleeping && myShape != 0u && otherShape != 0u) {
          let myLocalPoint = dir * dist;
          let mySDF = particleShapeSDF(myLocalPoint, myShape, myRadius, age);
          let otherLocalPoint = -dir * dist;
          let otherSDF = particleShapeSDF(otherLocalPoint, otherShape, otherRadius, otherAge);
          let combinedDist = min(mySDF, otherSDF);
          effectiveDist = max(combinedDist, effectiveDist);
        }
        
        // Apply collision response
        let activationDist = (myRadius + otherRadius) * 0.5;
        
        if (effectiveDist < activationDist) {
          hadCollision = true;
          let penetration = activationDist - effectiveDist;
          
          // ========== MASS-WEIGHTED RESPONSE ==========
          // Lighter particles get pushed more, heavier ones less
          let totalMass = myMass + otherMass;
          let myMassRatio = otherMass / totalMass;  // I get pushed by other's mass ratio
          
          // Strong repulsion when penetrating, softer at range
          let hardCollision = select(0.0, 8.0, effectiveDist < 0.0);
          let softRepulsion = penetration * 2.0;
          let strength = (hardCollision + softRepulsion) * myMassRatio;
          
          separationForce += dir * strength;
          
          // ========== POSITION CORRECTION (mass-weighted) ==========
          if (effectiveDist < 0.0) {
            positionCorrection += dir * (-effectiveDist) * myMassRatio * 0.5;
          }
          
          // ========== PROPER FRICTION MODEL ==========
          // Apply friction when particles are in contact
          if (effectiveDist < 0.0) {
            let relativeVel = vel.xyz - otherVel;
            let velNormal = dot(relativeVel, dir);
            let velTangent = relativeVel - dir * velNormal;
            let tangentSpeed = length(velTangent);
            
            // Apply Coulomb friction to tangent velocity
            if (tangentSpeed > 0.001) {
              let frictionCoef = 0.3;  // Particle-particle friction
              let normalForce = abs(penetration) * strength;
              let maxFriction = frictionCoef * normalForce * dt * myInvMass;
              let frictionReduction = min(maxFriction / tangentSpeed, 0.5);  // Cap at 50%
              separationForce -= velTangent * frictionReduction;
            }
            
            // ========== ANGULAR RESPONSE (non-spherical shapes spin) ==========
            let angularImpulse = computeAngularResponse(myShape, dir, relativeVel, penetration);
            separationForce += angularImpulse * myMassRatio;
            
            // ========== VORTEX/TURBULENCE on collision ==========
            // Add swirl when particles collide (organic look)
            let vortex = vortexForce(newPos, dir, penetration * 0.5);
            separationForce += vortex * myMassRatio;
          }
          
          // ========== COHESION (same shape particles attract) ==========
          if (myShape == otherShape && effectiveDist > 0.0 && effectiveDist < activationDist * 2.0) {
            // Same-type particles have slight attraction (clustering)
            let cohesionStrength = 0.3 * myMassRatio;
            separationForce -= dir * cohesionStrength;
          }
          
          // ========== CROSS-EMITTER REACTIONS ==========
          // When particles of different materials collide, scan the reaction table
          let otherMat = u32(thermalData[j].z) & 0xFFu;
          if (myMat != otherMat && myMat > 0u && otherMat > 0u && reactionTable.count > 0u) {
            let rCount = min(reactionTable.count, 32u);
            for (var r = 0u; r < rCount; r++) {
              let rule = reactionTable.rules[r];
              let matchAB = (rule.matA == myMat && rule.matB == otherMat);
              let matchBA = (rule.matA == otherMat && rule.matB == myMat);
              if (matchAB || matchBA) {
                // Apply energy release to this particle
                thermalData[i].x += rule.energyRelease;
                
                // Kill this particle if rule flags say so
                let amA = select(matchBA, matchAB, true); // Am I reactant A?
                let killA = (rule.flags & 1u) != 0u;
                let killB = (rule.flags & 2u) != 0u;
                if ((amA && killA) || (!amA && killB)) {
                  age = lifetime + 1.0;
                }
                
                // Emit reaction event (only lower-index particle emits to avoid duplicates)
                let spawnProduct = (rule.flags & 4u) != 0u;
                if (i < j && spawnProduct) {
                  let midpoint = (newPos + otherPos) * 0.5;
                  let avgVel = (vel.xyz + otherVel) * 0.5;
                  emitEvent(midpoint, avgVel, 5.0, f32(r));
                }
                break; // Only one reaction per collision pair
              }
            }
          }
        }
        
        // ========== SPECULATIVE CONTACTS (predict future collision) ==========
        else if (effectiveDist < activationDist * 3.0) {
          let combinedRadius = myRadius + otherRadius;
          let collisionTime = predictCollisionTime(newPos, vel.xyz, otherPos, combinedRadius, dt * 2.0);
          
          if (collisionTime < dt * 2.0 && collisionTime > 0.0) {
            // Collision predicted soon - apply gentle pre-emptive force
            let preemptiveStrength = 0.5 * (1.0 - collisionTime / (dt * 2.0));
            separationForce += dir * preemptiveStrength;
          }
        }
      }
      
      // ========== CURL NOISE TURBULENCE ==========
      // Add organic turbulence only when collisions actually occurred
      var turbulence = vec3<f32>(0.0);
      if (hadCollision) {
        let turbulenceScale = 2.0;
        let turbulenceStrength = 0.3 * (1.0 - myLifeRatio);  // Stronger for young particles
        turbulence = curlNoise(newPos * turbulenceScale, age) * turbulenceStrength;
      }
      
      // Apply accumulated forces
      newPos = newPos + positionCorrection;
      vel = vec4<f32>(vel.xyz + separationForce * dt + turbulence * dt, vel.w);
    }
  }
  
  // ========== KILL ZONES (Niagara parity: analytical shape bounds) ==========
  // killZoneData[0].x = zone count (0-4)
  // Then pairs: killZoneData[1+kz*2] = vec4(centerX, centerY, centerZ, type)
  //             killZoneData[2+kz*2] = vec4(param0, param1, param2, invert)
  // type: 1=box (halfExtents in params), 2=sphere (radius in param0), 3=plane (normal in center, dist in param0)
  let kzCount = min(u32(killZoneData[0].x), 4u);
  for (var kz = 0u; kz < kzCount; kz++) {
    let kzIdx = 1u + kz * 2u;
    let kzData0 = killZoneData[kzIdx];
    let kzData1 = killZoneData[kzIdx + 1u];
    let kzType = kzData0.w;
    let kzCenter = kzData0.xyz;
    let invert = kzData1.w > 0.5;
    var inside = false;

    if (kzType > 0.5 && kzType < 1.5) {
      // Box kill zone: center=kzCenter, halfExtents=kzData1.xyz
      let d = abs(newPos - kzCenter);
      inside = (d.x < kzData1.x && d.y < kzData1.y && d.z < kzData1.z);
    } else if (kzType > 1.5 && kzType < 2.5) {
      // Sphere kill zone: center=kzCenter, radius=kzData1.x
      let d2 = dot(newPos - kzCenter, newPos - kzCenter);
      inside = (d2 < kzData1.x * kzData1.x);
    } else if (kzType > 2.5 && kzType < 3.5) {
      // Plane kill zone: normal=kzCenter, distance=kzData1.x (kills particles behind plane)
      inside = (dot(newPos, kzCenter) - kzData1.x < 0.0);
    }

    if (invert) { inside = !inside; }
    if (inside) {
      emitEvent(newPos, vel.xyz, 4.0, thermal.x);
      age = lifetime + 1.0; // Kill particle
      break;
    }
  }

  positions[i] = vec4<f32>(newPos, age);
  velocities[i] = vel;
}
`;
}

function createGridCollisionComputeShader(workgroupSize) {
  const size = normalizeWorkgroupSize(workgroupSize, 256);
  return `
struct Params {
  dt: f32,
  particleCount: u32,
  roomHalfSize: f32,
  gravityY: f32,
  baseIndex: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;
@group(0) @binding(3) var<storage, read> owners : array<u32>;
@group(0) @binding(4) var<storage, read_write> cellCounts : array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cellIndices : array<u32>;
@group(0) @binding(6) var<storage, read> thermalData : array<vec4<f32>>;

const OWNER_LOCAL_MASK: u32 = ${(OWNER_LOCAL_MASK >>> 0)}u;
const OWNER_ID_SHIFT: u32 = ${OWNER_ID_SHIFT}u;

fn absDiffU32(a: u32, b: u32) -> u32 {
  return select(a - b, b - a, b > a);
}

fn cellIndexFromPos(pos: vec3<f32>, bounds: f32, cellSize: f32, gridDims: u32) -> u32 {
  let gd = max(gridDims, 1u);
  let b = max(bounds, 1e-6);
  let minp = vec3<f32>(-b, -b, -b);
  let p = clamp(pos, minp, -minp);
  let rel = (p - minp) / max(cellSize, 1e-6);
  let cx = u32(clamp(floor(rel.x), 0.0, f32(gd - 1u)));
  let cy = u32(clamp(floor(rel.y), 0.0, f32(gd - 1u)));
  let cz = u32(clamp(floor(rel.z), 0.0, f32(gd - 1u)));
  return cx + cy * gd + cz * gd * gd;
}

fn cellCoordFromIndex(idx: u32, gridDims: u32) -> vec3<u32> {
  let gd = max(gridDims, 1u);
  let plane = gd * gd;
  let z = idx / plane;
  let rem = idx - z * plane;
  let y = rem / gd;
  let x = rem - y * gd;
  return vec3<u32>(x, y, z);
}

fn cellIndexFromCoord(c: vec3<u32>, gridDims: u32) -> u32 {
  let gd = max(gridDims, 1u);
  return c.x + c.y * gd + c.z * gd * gd;
}

@compute @workgroup_size(${size})
fn clearGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let gd = max(params._pad0, 1u);
  let cellCount = gd * gd * gd;
  let idx = gid.x;
  if (idx < cellCount) {
    atomicStore(&cellCounts[idx], 0u);
  }
}

@compute @workgroup_size(${size})
fn binParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let local = gid.x;
  if (local >= params.particleCount) {
    return;
  }

  let i = local + params.baseIndex;
  // Dead particle early-out: don't bin particles past their lifetime
  let age = positions[i].w;
  let lifetime = velocities[i].w;
  if (age >= lifetime) { return; }

  let gridDims = max(params._pad0, 1u);
  let cellCap = max(params._pad1, 1u);
  let bounds = max(params.roomHalfSize, 1e-6);
  let cellSize = (bounds * 2.0) / f32(gridDims);
  let ci = cellIndexFromPos(positions[i].xyz, bounds, cellSize, gridDims);
  let slot = atomicAdd(&cellCounts[ci], 1u);
  if (slot < cellCap) {
    cellIndices[ci * cellCap + slot] = i;
  }
}

@compute @workgroup_size(${size})
fn collide(@builtin(global_invocation_id) gid: vec3<u32>) {
  let local = gid.x;
  if (local >= params.particleCount) {
    return;
  }

  let i = local + params.baseIndex;
  // Dead particle early-out: skip grid collision for dead particles
  let age = positions[i].w;
  let lifetime = velocities[i].w;
  if (age >= lifetime) { return; }

  let gridDims = max(params._pad0, 1u);
  let cellCap = max(params._pad1, 1u);
  let ropeSkip = params._pad2;
  let bounds = max(params.roomHalfSize, 1e-6);
  let cellSize = (bounds * 2.0) / f32(gridDims);

  let p0 = positions[i].xyz;
  var v0 = velocities[i];
  // Collision group: upper bits of thermalData.z (lower 8 = materialIdx)
  let myGroup = u32(thermalData[i].z) >> 8u;

  let collisionRadius = 0.5;
  let separationRadius = 1.5;
  let separationRadiusSq = separationRadius * separationRadius;

  let cellIdx = cellIndexFromPos(p0, bounds, cellSize, gridDims);
  let baseCoord = cellCoordFromIndex(cellIdx, gridDims);

  let rangeF = separationRadius / max(cellSize, 1e-6);
  let range = i32(clamp(ceil(rangeF), 1.0, 8.0));

  let oi = owners[i];
  let ropeI = oi >> OWNER_ID_SHIFT;
  let localI = oi & OWNER_LOCAL_MASK;

  var separationForce = vec3<f32>(0.0);
  var checks: u32 = 0u;
  let maxChecks: u32 = 96u;

  for (var dz: i32 = -range; dz <= range; dz = dz + 1) {
    for (var dy: i32 = -range; dy <= range; dy = dy + 1) {
      for (var dx: i32 = -range; dx <= range; dx = dx + 1) {
        if (checks >= maxChecks) { break; }

        let nx = i32(baseCoord.x) + dx;
        let ny = i32(baseCoord.y) + dy;
        let nz = i32(baseCoord.z) + dz;

        if (nx < 0 || ny < 0 || nz < 0) { continue; }
        if (nx >= i32(gridDims) || ny >= i32(gridDims) || nz >= i32(gridDims)) { continue; }

        let nci = cellIndexFromCoord(vec3<u32>(u32(nx), u32(ny), u32(nz)), gridDims);
        let count = min(atomicLoad(&cellCounts[nci]), cellCap);

        for (var k: u32 = 0u; k < count; k = k + 1u) {
          if (checks >= maxChecks) { break; }
          let j = cellIndices[nci * cellCap + k];
          if (j == i) { continue; }

          if (ropeI != 0u) {
            let oj = owners[j];
            let ropeJ = oj >> OWNER_ID_SHIFT;
            if (ropeJ == ropeI) {
              let localJ = oj & OWNER_LOCAL_MASK;
              if (absDiffU32(localI, localJ) <= ropeSkip) {
                continue;
              }
            }
          }

          // Collision group filter: same non-zero group = skip
          let otherGroup = u32(thermalData[j].z) >> 8u;
          if (myGroup != 0u && myGroup == otherGroup) { continue; }

          let p1 = positions[j].xyz;
          let offset = p0 - p1;
          let d2 = dot(offset, offset);
          if (d2 > 0.000001 && d2 < separationRadiusSq) {
            let distN = sqrt(d2);
            let inv = 1.0 / distN;
            let hardCollision = select(0.0, 5.0, distN < collisionRadius);
            let softRepulsion = (separationRadius - distN) * 1.5;
            let strength = hardCollision + softRepulsion;
            separationForce += offset * inv * strength;
          }

          checks = checks + 1u;
        }
      }
    }
  }

  v0 = vec4<f32>(v0.xyz + separationForce * params.dt, v0.w);
  velocities[i] = v0;
}
`;
}

function initGridCollisionSystem(world) {
  if (!world || !world.device) {
    return false;
  }
  if (!world.gridCountsBuffer || !world.gridIndicesBuffer) {
    return false;
  }
  if (!world.ownerBuffer || !world.positionBuffer || !world.velocityBuffer || !world.paramsBuffer) {
    return false;
  }
  if (world.gridCollisionSystem) {
    return true;
  }

  const device = world.device;
  const shaderModule = device.createShaderModule({
    label: "ParticleGridCollision.shader",
    code: createGridCollisionComputeShader(world.workgroupSize),
  });

  // Create explicit bind group layout with all 6 bindings
  // (auto-derived layouts differ per entry point based on which bindings each uses)
  const bindGroupLayout = device.createBindGroupLayout({
    label: "ParticleGridCollision.bindGroupLayout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "ParticleGridCollision.pipelineLayout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const clearGridPipeline = device.createComputePipeline({
    label: "ParticleGridCollision.clearGrid",
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: "clearGrid" },
  });
  const binParticlesPipeline = device.createComputePipeline({
    label: "ParticleGridCollision.binParticles",
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: "binParticles" },
  });
  const collidePipeline = device.createComputePipeline({
    label: "ParticleGridCollision.collide",
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: "collide" },
  });

  // thermalBuffer is required for collision group filtering; guard against null
  if (!world.thermalBuffer) {
    console.warn("[ParticleGridCollision] thermalBuffer required for collision group filtering");
    return false;
  }

  const bindGroup = device.createBindGroup({
    label: "ParticleGridCollision.bindGroup",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: world.positionBuffer } },
      { binding: 1, resource: { buffer: world.velocityBuffer } },
      { binding: 2, resource: { buffer: world.paramsBuffer } },
      { binding: 3, resource: { buffer: world.ownerBuffer } },
      { binding: 4, resource: { buffer: world.gridCountsBuffer } },
      { binding: 5, resource: { buffer: world.gridIndicesBuffer } },
      { binding: 6, resource: { buffer: world.thermalBuffer } },
    ],
  });

  // Create shared-memory collide pipeline (same layout, cell-centric dispatch)
  let sharedMemCollidePipeline = null;
  try {
    sharedMemCollidePipeline = createSharedMemCollidePipeline(device, bindGroupLayout, world.workgroupSize || 256);
  } catch (e) {
    console.warn("[ParticleGridCollision] Shared-memory collide pipeline failed, using standard:", e.message);
  }

  world.gridCollisionSystem = {
    shaderModule,
    clearGrid: clearGridPipeline,
    binParticles: binParticlesPipeline,
    collide: collidePipeline,
    sharedMemCollide: sharedMemCollidePipeline,
    bindGroup,
    bindGroupLayout,
    // SharedMem collide dispatches one workgroup per cell (262K for 64³ grid) — too expensive
    // without a compacted active-cell list. Standard collide dispatches per-particle (~391 wg).
    useSharedMem: false,
  };

  return true;
}

export async function createParticleSimWorld(gpuDevice, options = {}) {
  const _t0 = performance.now();

  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("createParticleSimWorld: gpuDevice (GpuDevice) is required");
  }

  const device = gpuDevice.getDevice();
  if (!device) {
    throw new Error("createParticleSimWorld: gpuDevice.getDevice() returned null");
  }

  let maxParticles = normalizePositiveInt(
    options.maxParticles,
    DEFAULT_MAX_PARTICLES
  );
  const workgroupSize = normalizeWorkgroupSize(options.workgroupSize, 256);

  try {
    if (gpuDevice && typeof gpuDevice.getCapabilities === "function") {
      const caps = gpuDevice.getCapabilities();
      const limits = caps && caps.limits;
      const maxStorageBytes =
        limits && typeof limits.maxStorageBufferBindingSize === "number"
          ? limits.maxStorageBufferBindingSize
          : null;
      if (
        maxStorageBytes &&
        Number.isFinite(maxStorageBytes) &&
        maxStorageBytes > 0
      ) {
        const maxByLimit = Math.floor(maxStorageBytes / PARTICLE_STRIDE_BYTES);
        if (maxByLimit > 0 && maxParticles > maxByLimit) {
          maxParticles = maxByLimit;
        }
      }
    }
  } catch (error) {
    // If capability lookup fails, fall back to the requested value.
  }

  const _t1 = performance.now();
  
  const positionsByteSize = maxParticles * PARTICLE_STRIDE_BYTES;
  const velocitiesByteSize = maxParticles * PARTICLE_STRIDE_BYTES;
  const metaByteSize = maxParticles * PARTICLE_STRIDE_BYTES; // vec4 per particle: [r, g, b, size]
  const uvsByteSize = maxParticles * PARTICLE_STRIDE_BYTES;
  const thermalByteSize = maxParticles * PARTICLE_STRIDE_BYTES; // vec4 per particle: [temperature, phase, groupId, restDensity]
  const collidersByteSize = MAX_GPU_COLLIDERS * COLLIDER_STRIDE_BYTES;

  const candidate = { device };
  let committed = false;
  try {
  const positionBuffer = candidate.positionBuffer = createStorageBuffer(device, positionsByteSize, {
    label: "ParticleSimWorld.positions",
  });
  const velocityBuffer = candidate.velocityBuffer = createStorageBuffer(device, velocitiesByteSize, {
    label: "ParticleSimWorld.velocities",
  });
  const metaBuffer = candidate.metaBuffer = createStorageBuffer(device, metaByteSize, {
    label: "ParticleSimWorld.meta",
  });
  const ownerBuffer = candidate.ownerBuffer = createStorageBuffer(device, maxParticles * 4, {
    label: "ParticleSimWorld.owners",
  });
  const uvBuffer = candidate.uvBuffer = createStorageBuffer(device, uvsByteSize, {
    label: "ParticleSimWorld.uvs",
  });
  const thermalBuffer = candidate.thermalBuffer = createStorageBuffer(device, thermalByteSize, {
    label: "ParticleSimWorld.thermal",
  });
  const paramsBuffer = candidate.paramsBuffer = createUniformBuffer(device, 48, {
    label: "ParticleSimWorld.params",
  });
  const colliderBuffer = candidate.colliderBuffer = createStorageBuffer(device, collidersByteSize, {
    label: "ParticleSimWorld.colliders",
  });
  const colliderParamsBuffer = candidate.colliderParamsBuffer = createUniformBuffer(device, 16, {
    label: "ParticleSimWorld.colliderParams",
  });

  const _t2 = performance.now();

  labelResource(positionBuffer, "ParticleSimWorld.positions");
  labelResource(velocityBuffer, "ParticleSimWorld.velocities");
  labelResource(metaBuffer, "ParticleSimWorld.meta");
  labelResource(ownerBuffer, "ParticleSimWorld.owners");
  labelResource(uvBuffer, "ParticleSimWorld.uvs");
  labelResource(thermalBuffer, "ParticleSimWorld.thermal");
  labelResource(paramsBuffer, "ParticleSimWorld.params");
  labelResource(colliderBuffer, "ParticleSimWorld.colliders");
  labelResource(colliderParamsBuffer, "ParticleSimWorld.colliderParams");

  const shaderCode = createParticleComputeShader(workgroupSize);
  
  const _t3 = performance.now();

  const shaderModule = device.createShaderModule({
    label: "ParticleSimWorld.computeShader",
    code: shaderCode,
  });

  const _t4 = performance.now();

  const pipeline = await withErrorScope(device, async () => {
    const desc = {
      label: "ParticleSimWorld.pipeline",
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    };

    if (typeof device.createComputePipelineAsync === "function") {
      return await device.createComputePipelineAsync(desc);
    }
    return device.createComputePipeline(desc);
  });
  
  const _t5 = performance.now();
  console.log(`[ParticleSimWorld] Timing: setup=${(_t1-_t0).toFixed(1)}ms, buffers=${(_t2-_t1).toFixed(1)}ms, shaderGen=${(_t3-_t2).toFixed(1)}ms, shaderCompile=${(_t4-_t3).toFixed(1)}ms, pipeline=${(_t5-_t4).toFixed(1)}ms`);

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const bindGroups0 = candidate.bindGroups0 = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(0),
    [
      { name: "positions", binding: 0 },
      { name: "velocities", binding: 1 },
      { name: "params", binding: 2 },
      { name: "colliderBuffer", binding: 3 },
      { name: "colliderParams", binding: 4 },
      { name: "particleMeta", binding: 5 },
      { name: "thermalData", binding: 6 },
    ],
    { label: "ParticleSimWorld.bindGroup", maxEntries: 16, getBindGroup: externalGetBindGroup }
  );

  const bindGroup = candidate.bindGroup = bindGroups0.get({
    positions: positionBuffer,
    velocities: velocityBuffer,
    params: paramsBuffer,
    colliderBuffer,
    colliderParams: colliderParamsBuffer,
    particleMeta: metaBuffer,
    thermalData: thermalBuffer,
  }, "ParticleSimWorld.bindGroup");

  // Create dummy fluid buffers (used when no fluid is attached)
  // FluidParams: gridSize (3) + fluidEnabled (1) + worldMin (3) + pad (1) + worldMax (3) + fluidInfluence (1) = 12 floats = 48 bytes
  const fluidParamsBuffer = candidate.fluidParamsBuffer = createUniformBuffer(device, 48, {
    label: "ParticleSimWorld.fluidParams",
  });
  // Dummy velocity buffer - just 1 cell (disabled anyway)
  const dummyFluidVelocityBuffer = candidate.dummyFluidVelocityBuffer = createStorageBuffer(device, 16, {
    label: "ParticleSimWorld.dummyFluidVelocity",
  });

  labelResource(fluidParamsBuffer, "ParticleSimWorld.fluidParams");
  labelResource(dummyFluidVelocityBuffer, "ParticleSimWorld.dummyFluidVelocity");

  // Initialize fluid params to disabled state
  const fluidParamsData = new Float32Array(12);
  fluidParamsData[3] = 0.0; // fluidEnabled = 0
  updateBuffer(device, fluidParamsBuffer, fluidParamsData, 0);

  const bindGroupsFluid = candidate.bindGroupsFluid = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(1),
    [
      { name: "fluidVelocity", binding: 0 },
      { name: "fluidParams", binding: 1 },
    ],
    { label: "ParticleSimWorld.fluidBindGroup", maxEntries: 16, getBindGroup: externalGetBindGroup }
  );

  const fluidBindGroup = candidate.fluidBindGroup = bindGroupsFluid.get({
    fluidVelocity: dummyFluidVelocityBuffer,
    fluidParams: fluidParamsBuffer,
  }, "ParticleSimWorld.fluidBindGroup");

  // ForceParams uniform buffer (matches ForceParams struct: 80 bytes with alignment)
  const FORCE_PARAMS_BUFFER_SIZE = CommonStructs.ForceParams.layout.size;
  const forceParamsBuffer = candidate.forceParamsBuffer = createUniformBuffer(device, FORCE_PARAMS_BUFFER_SIZE, {
    label: "ParticleSimWorld.forceParams",
  });
  labelResource(forceParamsBuffer, "ParticleSimWorld.forceParams");

  // Force points uniform buffer: 16 points × vec4<f32> (x, y, z, strength)
  const MAX_FORCE_POINTS_GPU = 16;
  const forcePointsBuffer = candidate.forcePointsBuffer = createUniformBuffer(device, MAX_FORCE_POINTS_GPU * 16, {
    label: "ParticleSimWorld.forcePoints",
  });
  labelResource(forcePointsBuffer, "ParticleSimWorld.forcePoints");

  // Initialize force params to safe defaults (all zeros = no forces active)
  const forceParamsInit = new Float32Array(FORCE_PARAMS_BUFFER_SIZE / 4);
  // maxVelocity at offset 11 (after windDir[3], windStrength, gustPhase, gustStrength, turbStr, turbScale, turbSpeed, turbOctaves, fpCount)
  forceParamsInit[11] = 100.0; // default maxVelocity = 100 m/s
  // vortexAxis Y at offset 16 (vortexPos[3]+vortexStr + vortexAxis starts at 16)
  forceParamsInit[17] = 1.0;   // default vortexAxis = (0, 1, 0) 
  forceParamsInit[19] = 5.0;   // default vortexRadius = 5
  updateBuffer(device, forceParamsBuffer, forceParamsInit, 0);

  // Kill zones buffer: vec4[0].x = count, then pairs of vec4 per zone (up to 4 zones)
  // Total: 1 header + 4 zones × 2 vec4 = 9 vec4 = 144 bytes (round to 160 for alignment)
  const killZoneBuffer = candidate.killZoneBuffer = createUniformBuffer(device, 160, { label: "ParticleSimWorld.killZones" });
  const killZoneInit = new Float32Array(40); // 10 vec4 = 40 floats, all zeros (count = 0)
  updateBuffer(device, killZoneBuffer, killZoneInit, 0);

  // Event buffer: GPU-driven event generation (death, collision, kill zone)
  // 1024 events × 2 vec4 per event = 2048 vec4 = 32KB
  const MAX_GPU_EVENTS = 1024;
  const eventBuffer = candidate.eventBuffer = createStorageBuffer(device, MAX_GPU_EVENTS * 2 * 16, { label: "ParticleSimWorld.eventBuffer" });
  // Event counter: [0]=eventCount (atomic), [1]=maxEvents (constant)
  const eventCounterBuffer = candidate.eventCounterBuffer = device.createBuffer({
    label: "ParticleSimWorld.eventCounter",
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  // Initialize: count=0, maxEvents=1024
  device.queue.writeBuffer(eventCounterBuffer, 0, new Uint32Array([0, MAX_GPU_EVENTS]));

  // Reaction table buffer (cross-emitter particle reactions)
  const REACTION_TABLE_BUFFER_SIZE = 16 + 32 * 48; // header + 32 rules × 48 bytes
  const reactionTableBuffer = candidate.reactionTableBuffer = createUniformBuffer(device, REACTION_TABLE_BUFFER_SIZE, { label: "ParticleSimWorld.reactionTable" });
  labelResource(reactionTableBuffer, "ParticleSimWorld.reactionTable");
  // Initialize with 0 reactions
  device.queue.writeBuffer(reactionTableBuffer, 0, new Uint32Array([0, 0, 0, 0]));

  const bindGroupsForce = candidate.bindGroupsForce = new BindGroupSignals(
    device,
    pipeline.getBindGroupLayout(2),
    [
      { name: "forceParams", binding: 0 },
      { name: "forcePoints", binding: 1 },
      { name: "killZones", binding: 2 },
      { name: "eventBuffer", binding: 3 },
      { name: "eventCounter", binding: 4 },
      { name: "reactionTable", binding: 5 },
    ],
    { label: "ParticleSimWorld.forceBindGroup", maxEntries: 8, getBindGroup: externalGetBindGroup }
  );

  const forceBindGroup = candidate.forceBindGroup = bindGroupsForce.get({
    forceParams: forceParamsBuffer,
    forcePoints: forcePointsBuffer,
    killZones: killZoneBuffer,
    eventBuffer: eventBuffer,
    eventCounter: eventCounterBuffer,
    reactionTable: reactionTableBuffer,
  }, "ParticleSimWorld.forceBindGroup");

  // 3D noise texture + alive list for compact dispatch (group 3)
  // Always create dummies first so bind group 3 is valid; bake real texture after
  const dummyNoise = candidate._dummyNoise = createDummyNoiseTexture(device);
  const dummyAliveList = candidate._dummyAliveList = device.createBuffer({
    label: "ParticleSimWorld.dummyAliveList",
    size: 4, // Minimum 4 bytes
    usage: GPUBufferUsage.STORAGE,
  });
  const dummyAliveCounters = candidate._dummyAliveCounters = device.createBuffer({
    label: "ParticleSimWorld.dummyAliveCounters",
    size: 8, // 2 × u32, initialized to 0
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(dummyAliveCounters, 0, new Uint32Array([0, 0]));

  // Dummy vector field resources (disabled until real field is attached)
  const dummyVFTexture = candidate._dummyVFTexture = createVectorFieldTexture(device, 2, 'ParticleSimWorld.dummyVFTexture');
  const dummyVFView = dummyVFTexture.createView();
  const dummyVFSampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
  });
  const dummyVFParams = candidate._dummyVFParams = createUniformBuffer(device, 32, { label: 'ParticleSimWorld.dummyVFParams' });
  // Initialize: enabled = 0 (vfParams[1].w)
  device.queue.writeBuffer(dummyVFParams, 0, new Float32Array([0, 0, 0, 10, 1, 1, 0, 0]));

  // Group 3: noise + alive list + vector field (all in one group to stay within maxBindGroups=4)
  const noiseBindGroup = candidate.noiseBindGroup = device.createBindGroup({
    label: "ParticleSimWorld.noiseBindGroup",
    layout: pipeline.getBindGroupLayout(3),
    entries: [
      { binding: 0, resource: dummyNoise.textureView },
      { binding: 1, resource: dummyNoise.sampler },
      { binding: 2, resource: { buffer: dummyNoise.paramsBuffer } },
      { binding: 3, resource: { buffer: dummyAliveList } },
      { binding: 4, resource: { buffer: dummyAliveCounters } },
      { binding: 5, resource: dummyVFView },
      { binding: 6, resource: dummyVFSampler },
      { binding: 7, resource: { buffer: dummyVFParams } },
    ],
  });

  const world = Object.assign(candidate, {
    device,
    maxParticles,
    workgroupSize,
    config: { ...PARTICLE_CONFIG },
    pipeline,
    bindGroup,
    fluidBindGroup,
    bindGroups0,
    bindGroupsFluid,
    bindGroupsForce,
    forceBindGroup,
    noiseBindGroup,
    _dummyVFTexture: dummyVFTexture,
    _dummyVFView: dummyVFView,
    _dummyVFSampler: dummyVFSampler,
    _dummyVFParams: dummyVFParams,
    _dummyAliveList: dummyAliveList,
    _dummyAliveCounters: dummyAliveCounters,
    _dummyNoise: dummyNoise,
    noiseSystem: null, // Set later by initAllAdvancedSystems
    longRangeBackend: null,
    fmmSystem: null,
    particleMeshEwaldSystem: null,
    forceParamsBuffer,
    forcePointsBuffer,
    killZoneBuffer,
    eventBuffer,
    eventCounterBuffer,
    reactionTableBuffer,
    maxGpuEvents: MAX_GPU_EVENTS,
    fluidParamsBuffer,
    dummyFluidVelocityBuffer,
    positionBuffer,
    velocityBuffer,
    metaBuffer,
    ownerBuffer,
    uvBuffer,
    thermalBuffer,
    paramsBuffer,
    colliderBuffer,
    colliderParamsBuffer,
    maxColliders: MAX_GPU_COLLIDERS,
    // Fluid attachment state
    attachedFluidWorld: null,
    fluidWorldMin: null,
    fluidWorldMax: null,
    // Spatial grid (initialized on first use or by initAdvancedParticles)
    gridCountsBuffer: null,
    gridIndicesBuffer: null,
    // Line generation
    lineVertexBuffer: null,
    drawIndirectBuffer: null,
    maxLines: PARTICLE_CONFIG.maxLines,
    // Adaptive quality state
    adaptiveQuality: PARTICLE_CONFIG.adaptiveQuality,
    targetFps: PARTICLE_CONFIG.targetFps,
    qualityScale: 1.0,
    activeParticleCount: maxParticles,
    // Performance tracking
    lastFrameTime: 0,
    frameMsEma: 0,
    // Show toggles
    showLines: true,
    showParticles: true,
    connectionDistance: PARTICLE_CONFIG.connectionDistance,
    freeParticleCount: 0,
    gpuConstrainedCount: 0,
    physxCount: 0,
    pbdCount: 0,
    // Rope chain registry
    ropeChains: [],
    ropesByEntity: new Map(),
    _nextOwnerId: 1,
    _freeOwnerIds: [],
    _reservedHighWaterMark: maxParticles,
    _freeRanges: [],
  });

  committed = true;
  return world;
  } finally {
    if (!committed) {
      destroyParticleSimWorld(candidate);
    }
  }
}

export function destroyParticleSimWorld(world) {
  if (!world) {
    return;
  }
  world.bindGroups0?.clear?.();
  world.bindGroupsFluid?.clear?.();
  world.bindGroupsForce?.clear?.();
  destroyBuffers([
    world.positionBuffer,
    world.velocityBuffer,
    world.metaBuffer,
    world.ownerBuffer,
    world.uvBuffer,
    world.thermalBuffer,
    world.paramsBuffer,
    world.colliderBuffer,
    world.colliderParamsBuffer,
    world.forceParamsBuffer,
    world.forcePointsBuffer,
    world.fluidParamsBuffer,
    world.dummyFluidVelocityBuffer,
    world.gridCountsBuffer,
    world.gridIndicesBuffer,
    world.lineVertexBuffer,
    world.drawIndirectBuffer,
    world.trailHistoryBuffer,
  ]);
  
  // Destroy advanced systems
  if (world.sortSystem) {
    destroyRadixSortSystem(world.sortSystem);
    world.sortSystem = null;
  }
  if (world.chunkedSystem) {
    destroyChunkedBufferSystem(world.chunkedSystem);
  }
  if (world.wireSystem) {
    destroyBuffers([world.wireSystem.wireBuffer, world.wireSystem.paramsBuffer]);
  }
  if (world.sdfSystem) {
    destroyBuffers([world.sdfSystem.colliderBuffer, world.sdfSystem.paramsBuffer]);
  }
  if (world.seedingSystem) {
    destroyBuffers([world.seedingSystem.paramsBuffer]);
  }
  if (world.volumetricSystem) {
    destroyBuffers([world.volumetricSystem.paramsBuffer, world.volumetricSystem.lightContribBuffer]);
  }
  if (world.atlasSystem) {
    destroyTextureAtlasSystem(world.atlasSystem);
  }
  if (world.snapshotSystem) {
    destroySnapshotSystem(world.snapshotSystem);
  }
  if (world.ropeConstraintSystem) {
    destroyRopeConstraintSystem(world.ropeConstraintSystem);
  }
  if (world.heatSystem) {
    destroyBuffers([world.heatSystem.paramsBuffer, world.heatSystem.materialLUTBuffer]);
    world.heatSystem = null;
  }
  if (world.bondSystem) {
    destroyBondSystem(world.bondSystem);
    world.bondSystem = null;
  }
  if (world.ribbonTrailSystem) {
    destroyRibbonTrailSystem(world.ribbonTrailSystem);
    world.ribbonTrailSystem = null;
  }
  if (world._dummyAliveList) { world._dummyAliveList.destroy(); world._dummyAliveList = null; }
  if (world._dummyAliveCounters) { world._dummyAliveCounters.destroy(); world._dummyAliveCounters = null; }
  if (world._dummyNoise) {
    if (world._dummyNoise.texture) world._dummyNoise.texture.destroy();
    if (world._dummyNoise.paramsBuffer) world._dummyNoise.paramsBuffer.destroy();
    world._dummyNoise = null;
  }
  if (world.noiseSystem) {
    destroyNoiseTextureSystem(world.noiseSystem);
    world.noiseSystem = null;
  }
  if (world._dummyVFTexture) { world._dummyVFTexture.destroy(); world._dummyVFTexture = null; }
  if (world._dummyVFParams) { world._dummyVFParams.destroy(); world._dummyVFParams = null; }
  world._dummyVFView = null; world._dummyVFSampler = null;
  if (world.eventSystem) {
    destroyParticleEventSystem(world.eventSystem);
    world.eventSystem = null;
  }
  if (world.eventBuffer) { world.eventBuffer.destroy(); world.eventBuffer = null; }
  if (world.eventCounterBuffer) { world.eventCounterBuffer.destroy(); world.eventCounterBuffer = null; }
  if (world.reactionTableBuffer) { world.reactionTableBuffer.destroy(); world.reactionTableBuffer = null; }
  if (world.lifetimeCurvesSystem) {
    destroyLifetimeCurvesSystem(world.lifetimeCurvesSystem);
    world.lifetimeCurvesSystem = null;
  }
  if (world.vectorFieldSystem) {
    destroyVectorFieldSystem(world.vectorFieldSystem);
    world.vectorFieldSystem = null;
  }
  if (world.sdfAttractionSystem) {
    destroySDFAttractionSystem(world.sdfAttractionSystem);
    world.sdfAttractionSystem = null;
  }
  if (world.neighborGridSystem) {
    destroyNeighborGridSystem(world.neighborGridSystem);
    world.neighborGridSystem = null;
  }
  if (world.decalSpawner) {
    destroyDecalSpawner(world.decalSpawner);
    world.decalSpawner = null;
  }
  if (world.audioBridge) {
    destroyAudioBridge(world.audioBridge);
    world.audioBridge = null;
  }
  world.emitterLOD = null;
  world.adaptiveSubstepController = null;
  if (world.flockingSystem) {
    destroyFlockingSystem(world.flockingSystem);
    world.flockingSystem = null;
  }
  if (world.splineFollowSystem) {
    destroySplineFollowSystem(world.splineFollowSystem);
    world.splineFollowSystem = null;
  }
  if (world.surfaceProjectionSystem) {
    destroySurfaceProjectionSystem(world.surfaceProjectionSystem);
    world.surfaceProjectionSystem = null;
  }
  if (world.localSpaceSystem) {
    destroyLocalSpaceSystem(world.localSpaceSystem);
    world.localSpaceSystem = null;
  }
  if (world.softContainmentSystem) {
    destroySoftContainmentSystem(world.softContainmentSystem);
    world.softContainmentSystem = null;
  }
  if (world.eulerianFluidSolver) {
    destroyEulerianFluidSolver(world.eulerianFluidSolver);
    world.eulerianFluidSolver = null;
  }
  if (world.chemistrySystem) {
    destroyChemistrySystem(world.chemistrySystem);
    world.chemistrySystem = null;
  }
  if (world.nBodySystem) {
    destroyNBodySystem(world.nBodySystem);
    world.nBodySystem = null;
  }
  if (world.fmmSystem) {
    destroyFmmSystem(world.fmmSystem);
    world.fmmSystem = null;
  }
  if (world.particleMeshEwaldSystem) {
    destroyParticleMeshEwaldSystem(world.particleMeshEwaldSystem);
    world.particleMeshEwaldSystem = null;
  }
  world.longRangeBackend = null;
  if (world.sphSystem) {
    destroySPHSystem(world.sphSystem);
    world.sphSystem = null;
  }
  if (world.electromagneticSystem) {
    destroyElectromagneticSystem(world.electromagneticSystem);
    world.electromagneticSystem = null;
  }
  if (world.lennardJonesSystem) {
    destroyLennardJonesSystem(world.lennardJonesSystem);
    world.lennardJonesSystem = null;
  }
  if (world.elementTable) {
    destroyElementTable(world.elementTable);
    world.elementTable = null;
  }
  if (world.killZoneBuffer) { world.killZoneBuffer.destroy(); world.killZoneBuffer = null; }
  if (world.indirectSystem) {
    destroyIndirectDispatchSystem(world.indirectSystem);
    world.indirectSystem = null;
  }
  if (world.ropeInteractionSystem) {
    destroyRopeInteractionSystem(world.ropeInteractionSystem);
    world.ropeInteractionSystem = null;
  }
  world._positionsCPU = null;
  world._thermalCPU = null;
  
  // Clear rope chain registry
  if (world.ropeChains) world.ropeChains.length = 0;
  if (world.ropesByEntity) world.ropesByEntity.clear();
  
  world.positionBuffer = null;
  world.velocityBuffer = null;
  world.metaBuffer = null;
  world.ownerBuffer = null;
  world.uvBuffer = null;
  world.thermalBuffer = null;
  world.paramsBuffer = null;
  world.colliderBuffer = null;
  world.colliderParamsBuffer = null;
  world.forceParamsBuffer = null;
  world.forcePointsBuffer = null;
  world.fluidParamsBuffer = null;
  world.dummyFluidVelocityBuffer = null;
  world.gridCountsBuffer = null;
  world.gridIndicesBuffer = null;
  world.lineVertexBuffer = null;
  world.drawIndirectBuffer = null;
  world.trailHistoryBuffer = null;
  world.bindGroup = null;
  world.fluidBindGroup = null;
  world.forceBindGroup = null;
  world.noiseBindGroup = null;
  world.bindGroups0 = null;
  world.bindGroupsFluid = null;
  world.bindGroupsForce = null;
}

/**
 * Initialize spatial grid and line buffers for advanced particle features.
 * Call this after createParticleSimWorld to enable line connections and neighbor lookups.
 */
export function initAdvancedParticleBuffers(world, options = {}) {
  if (!world || !world.device) {
    return false;
  }
  
  const device = world.device;
  const config = world.config;
  
  const gridDims = options.gridDims || config.gridDims;
  const cellCap = options.cellCap || config.cellCap;
  const maxLines = options.maxLines || config.maxLines;
  
  const cellCount = gridDims * gridDims * gridDims;
  
  // Grid counts buffer: one atomic u32 per cell
  const gridCountsSize = cellCount * 4; // u32 per cell
  world.gridCountsBuffer = createStorageBuffer(device, gridCountsSize, {
    label: "ParticleSimWorld.gridCounts",
  });
  
  // Grid indices buffer: cellCap indices per cell
  const gridIndicesSize = cellCount * cellCap * 4; // u32 per index
  world.gridIndicesBuffer = createStorageBuffer(device, gridIndicesSize, {
    label: "ParticleSimWorld.gridIndices",
  });
  
  // Line vertex buffer: 2 vertices per line, 32 bytes per vertex (pos + color)
  const maxLineVertices = maxLines * 2;
  const lineVertexSize = maxLineVertices * 32; // vec4 pos + vec4 color = 32 bytes
  world.lineVertexBuffer = createStorageBuffer(device, lineVertexSize, {
    label: "ParticleSimWorld.lineVertices",
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  
  // Draw indirect buffer for indirect draw calls
  // DrawIndirect: vertexCount(u32), instanceCount(u32), firstVertex(u32), firstInstance(u32)
  world.drawIndirectBuffer = createStorageBuffer(device, 16, {
    label: "ParticleSimWorld.drawIndirect",
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  });
  
  // Store grid config
  world.gridDims = gridDims;
  world.cellCap = cellCap;
  world.maxLines = maxLines;
  world.maxLineVertices = maxLineVertices;
  
  labelResource(world.gridCountsBuffer, "ParticleSimWorld.gridCounts");
  labelResource(world.gridIndicesBuffer, "ParticleSimWorld.gridIndices");
  labelResource(world.lineVertexBuffer, "ParticleSimWorld.lineVertices");
  labelResource(world.drawIndirectBuffer, "ParticleSimWorld.drawIndirect");
  
  console.log(`[ParticleSimWorld] Advanced buffers initialized: grid ${gridDims}³, cellCap ${cellCap}, maxLines ${maxLines}`);
  return true;
}

/**
 * Initialize all advanced particle systems (sorting, wire constraints, SDF collision, etc.)
 * Call after createParticleSimWorld and initAdvancedParticleBuffers.
 */
export async function initAllAdvancedSystems(world, options = {}) {
  if (!world || !world.device) {
    console.warn("[ParticleSimWorld] Cannot init advanced systems - no device");
    return false;
  }
  
  const device = world.device;
  const maxParticles = world.maxParticles;
  
  // GPU Sorting for transparency (radix sort: 8 passes × 3 dispatches vs bitonic's ~289)
  if (options.enableSorting !== false) {
    world.sortSystem = createRadixSortSystem(device, maxParticles);
    initRadixSortBindGroups(world.sortSystem, device, world.positionBuffer);
    console.log("[ParticleSimWorld] GPU radix sort initialized");
  }
  
  // Wire constraints for connected particles
  if (options.enableWires) {
    const maxWires = options.maxWires || 10000;
    world.wireSystem = createWireConstraintSystem(device, maxWires);
    initWireBindGroup(world.wireSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log(`[ParticleSimWorld] Wire constraints initialized: max ${maxWires}`);
  }
  
  // SDF mesh collision
  if (options.enableSDFCollision) {
    const maxColliders = options.maxColliders || 64;
    world.sdfSystem = createSDFCollisionSystem(device, maxColliders);
    // Pass meta buffer for per-particle size collision
    initSDFBindGroup(world.sdfSystem, device, world.positionBuffer, world.velocityBuffer, world.metaBuffer);
    console.log(`[ParticleSimWorld] SDF collision initialized: max ${maxColliders} colliders (per-particle size enabled)`);
  }
  
  // GPU particle seeding
  if (options.enableSeeding !== false) {
    world.seedingSystem = createSeedingSystem(device);
    initSeedingBindGroup(world.seedingSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] GPU seeding initialized");
  }
  
  // Volumetric lighting
  if (options.enableVolumetric) {
    world.volumetricSystem = createVolumetricLightingSystem(device, maxParticles);
    initVolumetricBindGroup(world.volumetricSystem, device, world.positionBuffer, world.thermalBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] Volumetric lighting initialized");
  }
  
  // Depth buffer collision (bind group created lazily when depth texture is provided)
  if (options.enableDepthCollision !== false) {
    world.depthCollisionSystem = createDepthCollisionSystem(device, maxParticles);
  }
  
  // 3D noise texture for turbulence (bake once, replaces computed curl noise)
  if (options.enableNoiseTexture !== false) {
    const noiseRes = options.noiseResolution || 64;
    const noisePeriod = options.noisePeriod || 16.0;
    world.noiseSystem = await createNoiseTextureSystem(device, noiseRes, noisePeriod);
    bakeNoiseTexture(world.noiseSystem, device);
    // Replace dummy bind group with real noise texture (include alive buffers)
    const aliveListBuf = world.indirectSystem ? world.indirectSystem.aliveListBuffer : world._dummyAliveList;
    const aliveCounterBuf = world.indirectSystem ? world.indirectSystem.counterBuffer : world._dummyAliveCounters;
    // Get current VF resources (dummy or real if already initialized)
    const vfTV = world.vectorFieldSystem ? world.vectorFieldSystem.textureView : world._dummyVFView;
    const vfS = world.vectorFieldSystem ? world.vectorFieldSystem.sampler : world._dummyVFSampler;
    const vfPB = world.vectorFieldSystem ? world.vectorFieldSystem.paramsBuffer : world._dummyVFParams;
    world.noiseBindGroup = device.createBindGroup({
      label: "ParticleSimWorld.noiseBindGroup.baked",
      layout: world.pipeline.getBindGroupLayout(3),
      entries: [
        { binding: 0, resource: world.noiseSystem.noiseTextureView },
        { binding: 1, resource: world.noiseSystem.noiseSampler },
        { binding: 2, resource: { buffer: world.noiseSystem.noiseParamsBuffer } },
        { binding: 3, resource: { buffer: aliveListBuf } },
        { binding: 4, resource: { buffer: aliveCounterBuf } },
        { binding: 5, resource: vfTV },
        { binding: 6, resource: vfS },
        { binding: 7, resource: { buffer: vfPB } },
      ],
    });
    // Free dummy noise resources (no longer referenced after bind group replaced)
    if (world._dummyNoise) {
      if (world._dummyNoise.texture) world._dummyNoise.texture.destroy();
      if (world._dummyNoise.paramsBuffer) world._dummyNoise.paramsBuffer.destroy();
      world._dummyNoise = null;
    }
  }
  
  // Indirect draw + dispatch (GPU-driven particle counts, eliminates CPU↔GPU sync)
  if (options.enableIndirectDispatch !== false) {
    world.indirectSystem = createIndirectDispatchSystem(device, maxParticles, world.workgroupSize || 256);
    initIndirectDispatchBindGroups(world.indirectSystem, device, world.positionBuffer, world.velocityBuffer);
    // Rebuild group 3 bind group with real alive buffers from indirect system
    const noiseTV = world.noiseSystem ? world.noiseSystem.noiseTextureView : world._dummyNoise?.textureView;
    const noiseS = world.noiseSystem ? world.noiseSystem.noiseSampler : world._dummyNoise?.sampler;
    const noisePB = world.noiseSystem ? world.noiseSystem.noiseParamsBuffer : world._dummyNoise?.paramsBuffer;
    if (noiseTV && noiseS && noisePB) {
      // Get current VF resources (dummy or real if already initialized)
      const vfTV2 = world.vectorFieldSystem ? world.vectorFieldSystem.textureView : world._dummyVFView;
      const vfS2 = world.vectorFieldSystem ? world.vectorFieldSystem.sampler : world._dummyVFSampler;
      const vfPB2 = world.vectorFieldSystem ? world.vectorFieldSystem.paramsBuffer : world._dummyVFParams;
      world.noiseBindGroup = device.createBindGroup({
        label: "ParticleSimWorld.noiseBindGroup.withAlive",
        layout: world.pipeline.getBindGroupLayout(3),
        entries: [
          { binding: 0, resource: noiseTV },
          { binding: 1, resource: noiseS },
          { binding: 2, resource: { buffer: noisePB } },
          { binding: 3, resource: { buffer: world.indirectSystem.aliveListBuffer } },
          { binding: 4, resource: { buffer: world.indirectSystem.counterBuffer } },
          { binding: 5, resource: vfTV2 },
          { binding: 6, resource: vfS2 },
          { binding: 7, resource: { buffer: vfPB2 } },
        ],
      });
    }
    // Free dummy alive buffers
    if (world._dummyAliveList) { world._dummyAliveList.destroy(); world._dummyAliveList = null; }
    if (world._dummyAliveCounters) { world._dummyAliveCounters.destroy(); world._dummyAliveCounters = null; }
  }
  
  // Ribbon trail rendering (camera-facing triangle strips from position history)
  if (options.enableRibbonTrails) {
    const trailHistory = options.trailHistoryLength || 8;
    const trailFormat = options.trailTargetFormat || 'bgra8unorm';
    const trailOpts = { depthFormat: options.trailDepthFormat || null };
    world.ribbonTrailSystem = createRibbonTrailSystem(device, maxParticles, trailHistory, trailFormat, trailOpts);
    initRibbonTrailBindGroups(world.ribbonTrailSystem, device, world.positionBuffer, world.velocityBuffer);
    if (options.ribbonWidth != null) world.ribbonTrailSystem.ribbonWidth = options.ribbonWidth;
    if (options.ribbonColor) world.ribbonTrailSystem.color = options.ribbonColor;
    if (options.ribbonOpacity != null) world.ribbonTrailSystem.opacity = options.ribbonOpacity;
    console.log("[ParticleSimWorld] Ribbon trail system initialized");
  }
  
  // Texture atlas
  if (options.enableAtlas) {
    const atlasConfig = options.atlasConfig || {};
    world.atlasSystem = createTextureAtlasSystem(device, maxParticles, atlasConfig);
    initAtlasBindGroup(world.atlasSystem, device, world.positionBuffer, world.velocityBuffer);
    
    // Create procedural atlas if no texture provided
    if (!atlasConfig.textureUrl) {
      createProceduralAtlas(world.atlasSystem, device, {
        width: atlasConfig.atlasWidth || 512,
        height: atlasConfig.atlasHeight || 512,
        spriteSize: atlasConfig.spriteSize || 32,
      });
    }
    console.log("[ParticleSimWorld] Texture atlas initialized");
  }
  
  // Chunked buffers for 100M+ particles
  if (options.enableChunked && maxParticles > PARTICLE_CONFIG.hardMaxParticles / 10) {
    world.chunkedSystem = createChunkedBufferSystem(device, maxParticles, 16);
    console.log(`[ParticleSimWorld] Chunked buffers initialized: ${world.chunkedSystem.numChunks} chunks`);
  }
  
  // Rope constraint system (Phase 2 - GPU native ropes)
  if (options.enableRopeConstraints !== false) {
    const maxConstraints = options.maxConstraints || 100000;
    world.ropeConstraintSystem = createRopeConstraintSystem(device, maxConstraints);
    initRopeConstraintBindGroup(world.ropeConstraintSystem, device, world.positionBuffer, world.velocityBuffer, world.thermalBuffer);
    console.log(`[ParticleSimWorld] Chain constraints initialized: max ${maxConstraints}`);
  }
  
  // Heat conduction + phase transitions (requires spatial grid + thermal buffer)
  if (options.enableHeatConduction !== false && world.thermalBuffer && world.gridCountsBuffer) {
    world.heatSystem = createHeatConductionSystem(world);
    if (world.heatSystem && options.heatConfig) {
      const hc = options.heatConfig;
      if (hc.conductivity !== undefined) world.heatSystem.conductivity = hc.conductivity;
      if (hc.ambientTemp !== undefined) world.heatSystem.ambientTemp = hc.ambientTemp;
      if (hc.ambientRate !== undefined) world.heatSystem.ambientRate = hc.ambientRate;
      if (hc.meltPoint !== undefined) world.heatSystem.meltPoint = hc.meltPoint;
      if (hc.boilPoint !== undefined) world.heatSystem.boilPoint = hc.boilPoint;
      if (hc.freezePoint !== undefined) world.heatSystem.freezePoint = hc.freezePoint;
      if (hc.condensePoint !== undefined) world.heatSystem.condensePoint = hc.condensePoint;
    }
  }
  
  // GPU particle event system (exceeds Niagara parity: fully GPU-driven sub-emitter spawning)
  // Requires indirectSystem.freeList — must come after indirect dispatch init
  if (options.enableEventSystem !== false && world.indirectSystem?.freeListBuffer) {
    world.eventSystem = initParticleEventSystem(world, {
      enabled: options.eventSystemEnabled !== false,
    });
  }

  // Lifetime curves LUT (GAP 10: N-point Bezier for size/alpha/velocity over lifetime)
  if (options.enableLifetimeCurves) {
    const curvesConfig = options.lifetimeCurvesConfig || {};
    world.lifetimeCurvesSystem = createLifetimeCurvesSystem(device, curvesConfig);
    console.log("[ParticleSimWorld] Lifetime curves LUT initialized");
  }

  // Vector field forces (GAP 11: 3D authored flow fields)
  if (options.enableVectorField) {
    const vfRes = options.vectorFieldResolution || 32;
    world.vectorFieldSystem = createVectorFieldSystem(device, { resolution: vfRes });
    if (options.vectorFieldType) {
      generateProceduralVectorField(world.vectorFieldSystem, options.vectorFieldType);
    }
    if (options.vectorFieldConfig) {
      setVectorFieldParams(world.vectorFieldSystem, options.vectorFieldConfig);
    }
    // Set enabled flag in VF params: vfParams[1].w = 1.0 (or 0 if vfs.enabled is false)
    const vfs = world.vectorFieldSystem;
    const enabledParams = new Float32Array(8);
    enabledParams[0] = 0; enabledParams[1] = 0; enabledParams[2] = 0; enabledParams[3] = 10;
    enabledParams[4] = 1.0; enabledParams[5] = 1.0; enabledParams[6] = 0; enabledParams[7] = vfs.enabled ? 1.0 : 0.0;
    device.queue.writeBuffer(vfs.paramsBuffer, 0, enabledParams);
    // Rebuild group 3 bind group with real VF texture (bindings 5/6/7)
    const noiseTV3 = world.noiseSystem ? world.noiseSystem.noiseTextureView : world._dummyNoise?.textureView;
    const noiseS3 = world.noiseSystem ? world.noiseSystem.noiseSampler : world._dummyNoise?.sampler;
    const noisePB3 = world.noiseSystem ? world.noiseSystem.noiseParamsBuffer : world._dummyNoise?.paramsBuffer;
    const aliveLB3 = world.indirectSystem ? world.indirectSystem.aliveListBuffer : world._dummyAliveList;
    const aliveCB3 = world.indirectSystem ? world.indirectSystem.counterBuffer : world._dummyAliveCounters;
    if (noiseTV3 && noiseS3 && noisePB3 && aliveLB3 && aliveCB3) {
      world.noiseBindGroup = device.createBindGroup({
        label: 'ParticleSimWorld.noiseBindGroup.withVF',
        layout: world.pipeline.getBindGroupLayout(3),
        entries: [
          { binding: 0, resource: noiseTV3 },
          { binding: 1, resource: noiseS3 },
          { binding: 2, resource: { buffer: noisePB3 } },
          { binding: 3, resource: { buffer: aliveLB3 } },
          { binding: 4, resource: { buffer: aliveCB3 } },
          { binding: 5, resource: vfs.textureView },
          { binding: 6, resource: vfs.sampler },
          { binding: 7, resource: { buffer: vfs.paramsBuffer } },
        ],
      });
      // Free dummy VF resources (no longer referenced)
      if (world._dummyVFTexture) { world._dummyVFTexture.destroy(); world._dummyVFTexture = null; }
      if (world._dummyVFParams) { world._dummyVFParams.destroy(); world._dummyVFParams = null; }
      world._dummyVFView = null; world._dummyVFSampler = null;
    }
    console.log(`[ParticleSimWorld] Vector field initialized: ${vfRes}³ (${options.vectorFieldType || 'empty'})`);
  }

  // SDF attraction forces (GAP 15: attract/repel toward SDF surfaces)
  if (options.enableSDFAttraction) {
    world.sdfAttractionSystem = createSDFAttractionSystem(device);
    initSDFAttractionBindGroup(world.sdfAttractionSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] SDF attraction forces initialized");
  }

  // Emitter-level LOD (GAP 19: distance/screen-size based emitter switching)
  if (options.enableEmitterLOD !== false) {
    world.emitterLOD = createEmitterLOD(options.lodConfig || {});
    console.log("[ParticleSimWorld] Emitter LOD initialized");
  }

  // Adaptive substeps (GAP 20: CFL condition for auto substep count)
  if (options.enableAdaptiveSubsteps) {
    world.adaptiveSubstepController = createAdaptiveSubstepController(options.substepConfig || {});
    console.log("[ParticleSimWorld] Adaptive substeps initialized");
  }

  // Decal spawner (GAP 22: spawn decals from collision events)
  if (options.enableDecalSpawner) {
    world.decalSpawner = createDecalSpawner(options.decalConfig || {});
    console.log("[ParticleSimWorld] Decal spawner initialized");
  }

  // Audio bridge (GAP 23: trigger spatial audio from particle events)
  if (options.enableAudioBridge) {
    world.audioBridge = createAudioBridge(options.audioConfig || {});
    console.log("[ParticleSimWorld] Audio bridge initialized");
  }

  // General-purpose neighbor grid (GAP 25: spatial queries for flocking, interaction)
  if (options.enableNeighborGrid) {
    const gridConfig = { maxParticles: maxParticles, ...(options.neighborGridConfig || {}) };
    world.neighborGridSystem = createNeighborGridSystem(device, gridConfig);
    initNeighborGridBindGroups(world.neighborGridSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] General-purpose neighbor grid initialized");
  }

  // GPU Flocking/Boids (GAP 27: requires neighbor grid)
  if (options.enableFlocking && world.neighborGridSystem) {
    world.flockingSystem = createFlockingSystem(device, maxParticles);
    const gridBufs = getNeighborGridBuffers(world.neighborGridSystem);
    initFlockingBindGroups(world.flockingSystem, device, world.positionBuffer, world.velocityBuffer, gridBufs);
    if (options.flockingConfig) setFlockingParams(world.flockingSystem, options.flockingConfig);
    console.log("[ParticleSimWorld] GPU flocking/boids initialized");
  }

  // Spline/Path Following (GAP 28)
  if (options.enableSplineFollow) {
    world.splineFollowSystem = createSplineFollowSystem(device, maxParticles);
    initSplineFollowBindGroups(world.splineFollowSystem, device, world.positionBuffer, world.velocityBuffer);
    if (options.splineConfig) setSplineFollowParams(world.splineFollowSystem, options.splineConfig);
    console.log("[ParticleSimWorld] Spline/path following initialized");
  }

  // Surface Projection (GAP 29)
  if (options.enableSurfaceProjection) {
    world.surfaceProjectionSystem = createSurfaceProjectionSystem(device, maxParticles);
    initProjectionBindGroups(world.surfaceProjectionSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] Surface projection initialized");
  }

  // Local/World Space Toggle (GAP 30)
  if (options.enableLocalSpace) {
    world.localSpaceSystem = createLocalSpaceSystem(device, maxParticles);
    initLocalSpaceBindGroups(world.localSpaceSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] Local space transform initialized");
  }

  // Soft Containment (GAP 31)
  if (options.enableSoftContainment) {
    world.softContainmentSystem = createSoftContainmentSystem(device, maxParticles);
    initContainmentBindGroups(world.softContainmentSystem, device, world.positionBuffer, world.velocityBuffer);
    console.log("[ParticleSimWorld] Soft containment initialized");
  }

  // Eulerian Fluid Solver (GAP 32: grid-based 3D Stable Fluids)
  if (options.enableEulerianFluid) {
    const fluidConfig = options.eulerianFluidConfig || {};
    world.eulerianFluidSolver = createEulerianFluidSolver(device, fluidConfig);
    initFluidBindGroups(world.eulerianFluidSolver);
    if (fluidConfig.sources) {
      for (const src of fluidConfig.sources) {
        addFluidSource(world.eulerianFluidSolver, src);
      }
    }
    console.log("[ParticleSimWorld] Eulerian fluid solver initialized");
  }

  // Element Property System (GAP 33)
  if (options.enableElementTable) {
    world.elementTable = createElementTable(device, maxParticles);
    console.log("[ParticleSimWorld] Element table initialized (118 elements)");
  }

  // Lennard-Jones Potential (GAP 34: requires neighbor grid + element table)
  if (options.enableLennardJones && world.neighborGridSystem) {
    world.lennardJonesSystem = createLennardJonesSystem(device, maxParticles);
    const gridBufs = getNeighborGridBuffers(world.neighborGridSystem);
    initLJBindGroups(world.lennardJonesSystem, device, world.positionBuffer, world.velocityBuffer, gridBufs, world.elementTable, world.thermalBuffer);
    if (options.ljConfig) {
      const lj = world.lennardJonesSystem;
      if (options.ljConfig.globalEpsilon !== undefined) lj.globalEpsilon = options.ljConfig.globalEpsilon;
      if (options.ljConfig.globalSigma !== undefined) lj.globalSigma = options.ljConfig.globalSigma;
      if (options.ljConfig.cutoffMultiplier !== undefined) lj.cutoffMultiplier = options.ljConfig.cutoffMultiplier;
    }
    console.log("[ParticleSimWorld] Lennard-Jones potential initialized");
  }

  // Electromagnetic Forces (GAP 35: requires neighbor grid + element table charges)
  if (options.enableElectromagnetic && world.neighborGridSystem) {
    world.electromagneticSystem = createElectromagneticSystem(device, maxParticles);
    const gridBufs = getNeighborGridBuffers(world.neighborGridSystem);
    const chargeBuffer = world.elementTable?.chargeBuffer || null;
    initEMBindGroups(world.electromagneticSystem, device, world.positionBuffer, world.velocityBuffer, gridBufs, chargeBuffer, world.thermalBuffer);
    if (options.emConfig) {
      const em = world.electromagneticSystem;
      if (options.emConfig.coulombK !== undefined) em.coulombK = options.emConfig.coulombK;
      if (options.emConfig.debyeLength !== undefined) em.debyeLength = options.emConfig.debyeLength;
      if (options.emConfig.externalE !== undefined) em.externalE = options.emConfig.externalE;
      if (options.emConfig.externalB !== undefined) em.externalB = options.emConfig.externalB;
    }
    console.log("[ParticleSimWorld] Electromagnetic forces initialized");
  }

  // SPH Fluid Dynamics (GAP 36: requires neighbor grid)
  if (options.enableSPH && world.neighborGridSystem) {
    world.sphSystem = createSPHSystem(device, maxParticles);
    const gridBufs = getNeighborGridBuffers(world.neighborGridSystem);
    initSPHBindGroups(world.sphSystem, device, world.positionBuffer, world.velocityBuffer, gridBufs, world.thermalBuffer);
    if (options.sphConfig) setSPHParams(world.sphSystem, options.sphConfig);
    console.log("[ParticleSimWorld] SPH fluid dynamics initialized");
  }

  // Particle Classifier (fluid visual classification: bulk/surface/spray/foam/bubble)
  // Requires SPH density buffer — init after SPH system
  if (world.sphSystem) {
    world.classifierSystem = createClassifierSystem(device, maxParticles);
    const dpBuf = getSPHDensityBuffer(world.sphSystem);
    initClassifierBindGroups(world.classifierSystem, device, world.positionBuffer, world.velocityBuffer, world.thermalBuffer, dpBuf);
    console.log("[ParticleSimWorld] Particle classifier initialized (bulk/surface/spray/foam/bubble)");
  }

  // Opt-in long-range backend. Legacy enableNBody remains the direct default.
  if (options.longRangeConfig?.backend) {
    configureParticleLongRange(world, options.longRangeConfig);
  } else if (options.enableNBody) {
    world.nBodySystem = createNBodySystem(device, maxParticles);
    initNBodyBindGroups(world.nBodySystem, device, world.positionBuffer, world.velocityBuffer, world.metaBuffer, world.thermalBuffer);
    if (options.nBodyConfig) setNBodyParams(world.nBodySystem, options.nBodyConfig);
    world.longRangeBackend = 'direct';
    console.log("[ParticleSimWorld] N-body gravity initialized");
  }

  // Chemical Reactions (GAP 38: requires neighbor grid + element table + thermal)
  if (options.enableChemistry && world.neighborGridSystem && world.elementTable && world.thermalBuffer) {
    world.chemistrySystem = createChemistrySystem(device, maxParticles);
    const gridBufs = getNeighborGridBuffers(world.neighborGridSystem);
    initChemistryBindGroups(world.chemistrySystem, device, world.positionBuffer, world.velocityBuffer, gridBufs, world.elementTable, world.thermalBuffer);
    if (options.chemistryConfig) {
      const ch = world.chemistrySystem;
      if (options.chemistryConfig.bondRadius !== undefined) ch.bondRadius = options.chemistryConfig.bondRadius;
      if (options.chemistryConfig.activationEnergy !== undefined) ch.activationEnergy = options.chemistryConfig.activationEnergy;
      if (options.chemistryConfig.bondEnergy !== undefined) ch.bondEnergy = options.chemistryConfig.bondEnergy;
      if (options.chemistryConfig.dissociationTemp !== undefined) ch.dissociationTemp = options.chemistryConfig.dissociationTemp;
    }
    console.log("[ParticleSimWorld] Chemical reaction system initialized");
  }

  // Dynamic bond system (freeze/melt bonding, requires thermal + constraint systems)
  if (options.enableBonds !== false && world.thermalBuffer && world.ropeConstraintSystem) {
    world.bondSystem = createBondSystem(world);
    // Allocate CPU-side readback arrays for bond system
    world._positionsCPU = new Float32Array(maxParticles * 4);
    world._thermalCPU = new Float32Array(maxParticles * 4);
    if (options.bondConfig) {
      const bc = options.bondConfig;
      if (bc.maxBondsPerFrame !== undefined) world.bondSystem.maxBondsPerFrame = bc.maxBondsPerFrame;
      if (bc.bondCheckRadius !== undefined) world.bondSystem.bondCheckRadius = bc.bondCheckRadius;
      if (bc.cooldownFrames !== undefined) world.bondSystem.cooldownFrames = bc.cooldownFrames;
      if (bc.enableFreezeBonds !== undefined) world.bondSystem.enableFreezeBonds = bc.enableFreezeBonds;
      if (bc.enableStickyBonds !== undefined) world.bondSystem.enableStickyBonds = bc.enableStickyBonds;
    }
  }
  
  // Rope↔Particle interaction (heat, moisture, corrosion, burning, chain splitting)
  // Runs CPU-side using the same readback arrays as the bond system
  if (options.enableRopeInteraction !== false && world.ropeConstraintSystem) {
    world.ropeInteractionSystem = createRopeInteractionSystem();
    // Ensure CPU readback arrays exist (may already be created by bond system)
    if (!world._positionsCPU) world._positionsCPU = new Float32Array(maxParticles * 4);
    if (!world._thermalCPU) world._thermalCPU = new Float32Array(maxParticles * 4);
    console.log("[ParticleSimWorld] Rope↔particle interaction system initialized");
  }
  
  return true;
}

// ============================================================================
// HEAT CONDUCTION + PHASE TRANSITION COMPUTE SYSTEM
// ============================================================================

const HEAT_CONDUCTION_SHADER = `
struct HeatParams {
    particleCount: u32,
    gridDims: u32,
    cellCap: u32,
    dt: f32,
    bounds: f32,
    conductivity: f32,   // Global conductivity multiplier
    ambientTemp: f32,    // Environment temperature (Kelvin)
    ambientRate: f32,    // Rate of ambient heat exchange
    // Default phase transition thresholds (used when materialIdx == 0)
    meltPoint: f32,      // Solid → Liquid
    boilPoint: f32,      // Liquid → Gas
    freezePoint: f32,    // Liquid → Solid (can differ from meltPoint for hysteresis)
    condensePoint: f32,  // Gas → Liquid
}

// Per-material properties LUT: 16 materials × vec4(meltPoint, boilPoint, conductivity, latentHeat)
// Material 0 = default (uses params thresholds), materials 1-15 = presets
struct MaterialLUT {
    materials: array<vec4<f32>, 16>,
}

@group(0) @binding(0) var<uniform> params: HeatParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> thermalData: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> cellIndices: array<u32>;
@group(0) @binding(5) var<uniform> materialLUT: MaterialLUT;
@group(0) @binding(6) var<storage, read> velocities: array<vec4<f32>>;

fn cellIndexFromPos(pos: vec3<f32>, bounds: f32, cellSize: f32, gridDims: u32) -> u32 {
    let normalized = (pos + vec3<f32>(bounds)) / (bounds * 2.0);
    let coord = vec3<u32>(clamp(vec3<i32>(normalized * f32(gridDims)), vec3<i32>(0), vec3<i32>(i32(gridDims) - 1)));
    return coord.x + coord.y * gridDims + coord.z * gridDims * gridDims;
}

fn cellCoordFromIndex(idx: u32, gridDims: u32) -> vec3<u32> {
    return vec3<u32>(
        idx % gridDims,
        (idx / gridDims) % gridDims,
        idx / (gridDims * gridDims)
    );
}

@compute @workgroup_size(256)
fn heatConduction(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    var thermal = thermalData[i];
    var temperature = thermal.x;
    let phase = thermal.y;
    // thermal.z packing: lower 8 bits = materialIdx, upper bits = groupId
    let packed = u32(thermal.z);
    let materialIdx = min(packed & 0xFFu, 15u);
    // thermal.w = latent energy accumulator (absorbs energy during phase change)
    
    let pos = positions[i].xyz;
    let age = positions[i].w;
    
    // Dead particle early-out: skip heat conduction for particles past lifetime
    let lifetime = velocities[i].w;
    if (age >= lifetime) { return; }
    
    let gridDims = params.gridDims;
    let cellCap = params.cellCap;
    let bounds = params.bounds;
    let cellSize = (bounds * 2.0) / f32(gridDims);
    let dt = params.dt;
    
    // ========== NEIGHBOR HEAT TRANSFER ==========
    let cellIdx = cellIndexFromPos(pos, bounds, cellSize, gridDims);
    let baseCoord = cellCoordFromIndex(cellIdx, gridDims);
    
    var heatDelta: f32 = 0.0;
    var neighborCount: u32 = 0u;
    let maxChecks: u32 = 32u;
    var checks: u32 = 0u;
    let conductionRadius = cellSize * 2.0;
    let conductionRadiusSq = conductionRadius * conductionRadius;
    
    for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
        for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
            for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
                if (checks >= maxChecks) { break; }
                
                let nx = i32(baseCoord.x) + dx;
                let ny = i32(baseCoord.y) + dy;
                let nz = i32(baseCoord.z) + dz;
                
                if (nx < 0 || ny < 0 || nz < 0) { continue; }
                if (nx >= i32(gridDims) || ny >= i32(gridDims) || nz >= i32(gridDims)) { continue; }
                
                let nci = u32(nx) + u32(ny) * gridDims + u32(nz) * gridDims * gridDims;
                let count = min(atomicLoad(&cellCounts[nci]), cellCap);
                
                for (var k: u32 = 0u; k < count; k = k + 1u) {
                    if (checks >= maxChecks) { break; }
                    let j = cellIndices[nci * cellCap + k];
                    if (j == i) { continue; }
                    
                    let otherPos = positions[j].xyz;
                    let offset = pos - otherPos;
                    let d2 = dot(offset, offset);
                    
                    if (d2 > conductionRadiusSq || d2 < 0.0001) { continue; }
                    
                    let otherTemp = thermalData[j].x;
                    let dist = sqrt(d2);
                    
                    // Heat transfer: per-material conductivity from LUT, fallback to global
                    let matConductivity = select(params.conductivity, materialLUT.materials[materialIdx].z, materialIdx > 0u);
                    let transferRate = matConductivity * (1.0 - dist / conductionRadius);
                    heatDelta += (otherTemp - temperature) * transferRate;
                    neighborCount += 1u;
                    checks += 1u;
                }
            }
        }
    }
    
    // Average heat exchange across neighbors
    if (neighborCount > 0u) {
        heatDelta = heatDelta / f32(neighborCount);
    }
    
    // Ambient heat exchange (converge toward ambient temperature)
    let ambientDelta = (params.ambientTemp - temperature) * params.ambientRate;
    
    // Apply temperature change
    temperature = max(0.0, temperature + (heatDelta + ambientDelta) * dt);
    
    // ========== PHASE TRANSITIONS (per-material thresholds + latent heat) ==========
    // Look up material-specific thresholds; material 0 uses global params as fallback
    let mat = materialLUT.materials[materialIdx];
    let melt    = select(params.meltPoint,     mat.x, materialIdx > 0u);
    let boil    = select(params.boilPoint,     mat.y, materialIdx > 0u);
    let freeze  = select(params.freezePoint,   melt * 0.98, materialIdx > 0u); // 2% hysteresis
    let condense = select(params.condensePoint, boil * 0.98, materialIdx > 0u); // 2% hysteresis
    let latentHeat = select(0.0, mat.w, materialIdx > 0u);
    
    var newPhase = phase;
    var latentEnergy = thermal.w; // accumulated latent energy
    
    // Solid → Liquid (melting)
    if (phase < 0.5 && temperature > melt) {
        if (latentHeat > 0.0 && latentEnergy < latentHeat) {
            // Absorb energy into latent heat instead of raising temperature
            latentEnergy += (temperature - melt) * dt;
            temperature = melt; // clamp at melt point during transition
        } else {
            newPhase = 1.0;
            latentEnergy = 0.0; // reset for next transition
        }
    }
    // Liquid → Gas (boiling)
    if (phase >= 0.5 && phase < 1.5 && temperature > boil) {
        if (latentHeat > 0.0 && latentEnergy < latentHeat) {
            latentEnergy += (temperature - boil) * dt;
            temperature = boil;
        } else {
            newPhase = 2.0;
            latentEnergy = 0.0;
        }
    }
    // Gas → Liquid (condensation)
    if (phase >= 1.5 && phase < 2.5 && temperature < condense) {
        newPhase = 1.0;
        latentEnergy = 0.0;
    }
    // Liquid → Solid (freezing)
    if (phase >= 0.5 && phase < 1.5 && temperature < freeze) {
        newPhase = 0.0;
        latentEnergy = 0.0;
    }
    // Plasma threshold (very high temp gas becomes plasma)
    if (phase >= 1.5 && temperature > 10000.0) {
        newPhase = 3.0;
    }
    // Plasma cooling
    if (phase >= 2.5 && temperature < 8000.0) {
        newPhase = 2.0;
    }
    
    // Write back thermal data (w = latent energy accumulator)
    thermalData[i] = vec4<f32>(temperature, newPhase, thermal.z, latentEnergy);
}
`;

// Reusable buffer for heat params upload
const _heatParamsF32 = new Float32Array(12);
const _heatParamsU32 = new Uint32Array(_heatParamsF32.buffer);

// Material LUT indices — match THERMAL_MATERIAL_PRESETS order
// Material 0 = default (uses HeatParams thresholds), 1-15 = presets
// Indices 1-10: physical materials, 11-15: reaction-identity materials (unified with MATERIAL enum in ParticleReactionTable.js)
const MATERIAL_LUT_ORDER = ['water', 'ice', 'metal', 'wood', 'wax', 'lava', 'oil', 'glass', 'stone', 'plasma', 'fire', 'smoke', 'steam', 'sparks', 'debris'];
export const MATERIAL_INDEX = Object.fromEntries(MATERIAL_LUT_ORDER.map((k, i) => [k, i + 1]));

/**
 * Build Float32Array for the material LUT uniform buffer (16 materials × vec4).
 * Each vec4: (meltPoint, boilPoint, conductivity, latentHeat)
 */
function buildMaterialLUTData() {
    const data = new Float32Array(16 * 4); // 16 materials × 4 floats
    // Material 0 = default, leave zeros (shader falls back to params)
    for (let idx = 0; idx < MATERIAL_LUT_ORDER.length; idx++) {
        const preset = THERMAL_MATERIAL_PRESETS[MATERIAL_LUT_ORDER[idx]];
        if (!preset) continue;
        const base = (idx + 1) * 4;
        data[base + 0] = preset.meltPoint;
        data[base + 1] = preset.boilPoint;
        data[base + 2] = preset.conductivity;
        data[base + 3] = preset.latentHeat;
    }
    return data;
}

/**
 * Create heat conduction + phase transition compute system.
 * Requires spatial grid to be initialized (gridCountsBuffer, gridIndicesBuffer).
 */
export function createHeatConductionSystem(world) {
    if (!world || !world.device) return null;
    if (!world.gridCountsBuffer || !world.gridIndicesBuffer) {
        console.warn("[HeatConduction] Spatial grid required - call initAdvancedParticleBuffers first");
        return null;
    }
    if (!world.thermalBuffer) {
        console.warn("[HeatConduction] thermalBuffer required");
        return null;
    }
    
    const device = world.device;
    
    const shaderModule = device.createShaderModule({
        label: "HeatConduction.shader",
        code: HEAT_CONDUCTION_SHADER,
    });
    
    const paramsBuffer = createUniformBuffer(device, 48, {
        label: "HeatConduction.params",
    });
    labelResource(paramsBuffer, "HeatConduction.params");
    
    // Material LUT: 16 materials × vec4(meltPoint, boilPoint, conductivity, latentHeat) = 256 bytes
    const materialLUTBuffer = createUniformBuffer(device, 256, {
        label: "HeatConduction.materialLUT",
    });
    labelResource(materialLUTBuffer, "HeatConduction.materialLUT");
    updateBuffer(device, materialLUTBuffer, buildMaterialLUTData(), 0);
    
    const pipeline = device.createComputePipeline({
        label: "HeatConduction.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "heatConduction" },
    });
    
    const bindGroup = device.createBindGroup({
        label: "HeatConduction.bindGroup",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: world.positionBuffer } },
            { binding: 2, resource: { buffer: world.thermalBuffer } },
            { binding: 3, resource: { buffer: world.gridCountsBuffer } },
            { binding: 4, resource: { buffer: world.gridIndicesBuffer } },
            { binding: 5, resource: { buffer: materialLUTBuffer } },
            { binding: 6, resource: { buffer: world.velocityBuffer } },
        ],
    });
    
    const system = {
        pipeline,
        paramsBuffer,
        materialLUTBuffer,
        bindGroup,
        // Configurable parameters (defaults for material 0)
        conductivity: 0.5,
        ambientTemp: 293,     // Room temperature (Kelvin)
        ambientRate: 0.01,    // Slow ambient exchange
        meltPoint: 273,       // Water ice melting
        boilPoint: 373,       // Water boiling
        freezePoint: 270,     // Hysteresis: freeze slightly below melt
        condensePoint: 370,   // Hysteresis: condense slightly below boil
    };
    
    console.log("[HeatConduction] Heat conduction + phase transition system initialized (material LUT: " + MATERIAL_LUT_ORDER.length + " presets)");
    return system;
}

/**
 * Execute heat conduction compute pass.
 */
export function stepHeatConduction(world, dt) {
    if (!world || !world.heatSystem || !world.heatSystem.bindGroup) return;
    
    const system = world.heatSystem;
    const device = world.device;
    const particleCount = world.activeParticleCount || world.maxParticles;
    const gridDims = world.gridDims || world.config.gridDims;
    const cellCap = world.cellCap || world.config.cellCap;
    const bounds = world.config.bounds || 1e9;
    
    // Upload params
    _heatParamsU32[0] = particleCount;
    _heatParamsU32[1] = gridDims;
    _heatParamsU32[2] = cellCap;
    _heatParamsF32[3] = dt;
    _heatParamsF32[4] = bounds;
    _heatParamsF32[5] = system.conductivity;
    _heatParamsF32[6] = system.ambientTemp;
    _heatParamsF32[7] = system.ambientRate;
    _heatParamsF32[8] = system.meltPoint;
    _heatParamsF32[9] = system.boilPoint;
    _heatParamsF32[10] = system.freezePoint;
    _heatParamsF32[11] = system.condensePoint;
    
    updateBuffer(device, system.paramsBuffer, _heatParamsF32, 0);
    
    const encoder = device.createCommandEncoder({ label: "HeatConduction.step" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(system.pipeline);
    pass.setBindGroup(0, system.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
}

/**
 * Execute all active advanced particle systems in the simulation step.
 */
export function stepAdvancedSystems(world, dt, options = {}) {
  if (!world || !world.device) return;
  
  const device = world.device;
  const particleCountOption = options.particleCount;
  const particleCount =
    typeof particleCountOption === "number" && Number.isFinite(particleCountOption)
      ? (particleCountOption | 0)
      : (world.activeParticleCount || world.maxParticles);
  
  // NOTE: executeIndirectScan now runs inside stepParticleSimWorld (before main sim)
  // so the alive list is available for alive-list-based dispatch.
  // The indirect buffers (drawIndirect, dispatchIndirect) are still valid here.
  
  // Local space: convert world → local BEFORE forces so all calculations happen in emitter space
  if (world.localSpaceSystem) {
    executeWorldToLocal(world.localSpaceSystem, device, particleCount);
  }
  
  // Wire constraints (multiple iterations for stability)
  if (world.wireSystem && world.wireSystem.wireCount > 0) {
    solveWireConstraints(world.wireSystem, device, options.wireIterations || 4);
  }
  
  // Rope constraints (Phase 2 - GPU native ropes)
  if (world.ropeConstraintSystem && world.ropeConstraintSystem.constraintCount > 0) {
    solveRopeConstraints(world.ropeConstraintSystem, device, options.ropeIterations || 8, dt);
  }
  
  // SDF collision with per-particle size and shape-adaptive collision
  if (world.sdfSystem && world.sdfSystem.colliderCount > 0) {
    executeSDFCollision(
      world.sdfSystem, device, particleCount,
      options.bounciness ?? 0.3,
      options.friction ?? 0.1,
      {
        contactRadius: options.contactRadius ?? 0.1,
        barrierStiffness: options.barrierStiffness ?? 1e5,
        dt: dt,
        time: options.time ?? 0,  // Pass time for animated shape effects
      }
    );
  }
  
  // Depth buffer collision (particles bounce off scene geometry via depth buffer)
  if (world.depthCollisionSystem && options.depthTextureView) {
    // Lazily init/update bind group when depth texture changes (e.g. resize)
    initDepthCollisionBindGroup(
      world.depthCollisionSystem, device,
      world.positionBuffer, world.velocityBuffer,
      options.depthTextureView
    );
    if (options.viewProj && options.invViewProj) {
      executeDepthCollision(
        world.depthCollisionSystem, device, particleCount,
        options.viewProj, options.invViewProj,
        {
          resolution: options.resolution,
          dt: dt,
          bounciness: options.depthBounciness ?? 0.3,
          friction: options.depthFriction ?? 0.2,
          particleRadius: options.depthParticleRadius ?? 0.05,
          depthBias: options.depthBias ?? 0.0001,
          cameraPos: options.cameraPos,
          minCameraDist: options.minCameraDist ?? 1.5,
        }
      );
    }
  }
  
  // Heat conduction + phase transitions (requires spatial grid)
  if (world.heatSystem) {
    stepHeatConduction(world, dt);
  }
  
  // General-purpose neighbor grid (GAP 25): rebuild spatial structure for queries
  if (world.neighborGridSystem) {
    buildNeighborGrid(world.neighborGridSystem, device, particleCount);
  }

  // Eulerian Fluid (GAP 32): step 3D grid-based fluid solver
  if (world.eulerianFluidSolver) {
    stepEulerianFluid(world.eulerianFluidSolver, device, dt);
  }

  // GPU Flocking (GAP 27): runs after neighbor grid is built
  if (world.flockingSystem) {
    executeFlocking(world.flockingSystem, device, particleCount, dt);
  }

  // Spline/Path following (GAP 28)
  if (world.splineFollowSystem) {
    executeSplineFollow(world.splineFollowSystem, device, particleCount, dt);
  }

  // Surface Projection (GAP 29)
  if (world.surfaceProjectionSystem) {
    executeSurfaceProjection(world.surfaceProjectionSystem, device, particleCount, dt);
  }

  // Soft Containment (GAP 31)
  if (world.softContainmentSystem) {
    executeSoftContainment(world.softContainmentSystem, device, particleCount, dt);
  }

  // Lennard-Jones Potential (GAP 34): intermolecular forces via neighbor grid
  if (world.lennardJonesSystem) {
    executeLennardJones(world.lennardJonesSystem, device, particleCount, dt);
  }

  // Electromagnetic Forces (GAP 35): Coulomb + Lorentz
  if (world.electromagneticSystem) {
    executeElectromagnetic(world.electromagneticSystem, device, particleCount, dt);
  }

  // SPH Fluid Dynamics (GAP 36): two-pass density + force
  if (world.sphSystem) {
    executeSPH(world.sphSystem, device, particleCount, dt);
  }

  // Particle Classifier: classify liquid particles into bulk/surface/spray/foam/bubble
  // Runs after SPH so density buffer is fresh for this frame
  if (world.classifierSystem && world.sphSystem) {
    executeClassifier(world.classifierSystem, device, particleCount);
  }

  // Long-range force backend: direct oracle, open FMM, or periodic PME/ESP.
  if (world.nBodySystem) {
    executeNBody(world.nBodySystem, device, particleCount, dt, { encoder: options.encoder });
  } else if (world.fmmSystem) {
    executeFmm(world.fmmSystem, device, particleCount, dt, {
      encoder: options.encoder,
      config: options.longRangeConfig,
    });
  } else if (world.particleMeshEwaldSystem) {
    executeParticleMeshEwald(world.particleMeshEwaldSystem, device, particleCount, dt, {
      encoder: options.encoder,
      config: options.longRangeConfig,
    });
  }

  // Chemical Reactions (GAP 38): bond formation + dissociation
  if (world.chemistrySystem) {
    executeChemistry(world.chemistrySystem, device, particleCount, dt);
  }

  // SDF attraction forces (GAP 15): attract/repel particles toward SDF surfaces
  if (world.sdfAttractionSystem && world.sdfAttractionSystem.attractorCount > 0) {
    executeSDFAttraction(world.sdfAttractionSystem, device, particleCount, dt, options.time || 0);
  }

  // Decal spawner age update (GAP 22)
  if (world.decalSpawner) {
    updateDecals(world.decalSpawner, dt);
  }

  // GPU event system: spawn sub-particles from events (death, collision, kill zone)
  // Runs after main sim (events generated) and after indirect scan (free list built)
  if (world.eventSystem) {
    stepEventSystem(world.eventSystem);
  }

  // Audio bridge (GAP 23): trigger spatial audio from particle events
  if (world.audioBridge) {
    processAudioEvents(world.audioBridge, world, particleCount);
    flushPendingAudio(world.audioBridge);
  }

  // Dynamic bond system (freeze/melt bonding) — runs after heat so temperatures are fresh
  // Rope↔particle interaction also uses the same readback arrays
  const needsReadback = (world.bondSystem || world.ropeInteractionSystem) && world._positionsCPU && world._thermalCPU;
  if (needsReadback) {
    // Async readback then bond step + rope interaction — fire-and-forget to avoid blocking frame
    const bondPC = particleCount;
    const bondWorld = world;
    Promise.all([
      readbackPositionsFromGPU(bondWorld, bondWorld._positionsCPU, bondPC),
      readbackThermalFromGPU(bondWorld, bondWorld._thermalCPU, bondPC),
    ]).then(([posOk, thermalOk]) => {
      if (!posOk || !thermalOk) return;

      // Bond system
      if (bondWorld.bondSystem) {
        stepBondSystem(bondWorld, bondWorld.bondSystem, {
          positions: bondWorld._positionsCPU,
          thermalData: bondWorld._thermalCPU,
          particleCount: bondPC,
          freezePoint: bondWorld.heatSystem?.freezePoint ?? 270,
          meltPoint: bondWorld.heatSystem?.meltPoint ?? 273,
        });
      }

      // Rope↔particle interaction (heat, moisture, corrosion, burning, chain splitting)
      if (bondWorld.ropeInteractionSystem && bondWorld.ropeInteractionSystem.ropeStates.size > 0) {
        stepRopeInteraction(
          bondWorld.ropeInteractionSystem,
          bondWorld,
          bondWorld._positionsCPU,
          bondWorld._thermalCPU,
          null, // metaCPU — not needed for current interactions
          dt,
          bondWorld._ropeInteractionCallbacks || {}
        );
      }
    }).catch(() => {}); // Suppress readback errors silently
  }
  
  // Volumetric lighting
  if (world.volumetricSystem && options.lightPos) {
    computeVolumetricLighting(
      world.volumetricSystem, device, particleCount,
      options.lightPos,
      options.lightColor || [1, 1, 1],
      {
        intensity: options.lightIntensity || 1,
        density: options.lightDensity || 0.1,
        scattering: options.scattering || 1,
        absorption: options.absorption || 0.1,
      }
    );
  }
  
  // Texture atlas sprite assignment
  if (world.atlasSystem) {
    assignSpritesGPU(world.atlasSystem, device, particleCount, options.time || 0);
  }
  
  // Ribbon trail history update (runs LAST — needs final particle positions)
  if (world.ribbonTrailSystem) {
    updateTrailHistory(world.ribbonTrailSystem, device);
  }
  
  // Local space: convert local → world AFTER all forces so rendering sees world positions
  if (world.localSpaceSystem) {
    executeLocalToWorld(world.localSpaceSystem, device, particleCount);
  }
}

/**
 * Render ribbon trails into the given render pass.
 * Call during the render loop AFTER particle rendering.
 * @param {GPURenderPassEncoder} pass
 * @param {Object} world
 * @param {Float32Array} viewProjMatrix - 4×4 view-projection matrix
 * @param {Array|Float32Array} cameraPos - [x, y, z]
 * @param {number} instanceCount - particle count to render trails for
 */
export function renderWorldRibbonTrails(pass, world, viewProjMatrix, cameraPos, instanceCount) {
  if (!world || !world.ribbonTrailSystem) return;
  renderRibbonTrails(pass, world.ribbonTrailSystem, viewProjMatrix, cameraPos, instanceCount);
}

/**
 * Execute GPU sorting for transparent particle rendering.
 * Call before rendering particles back-to-front.
 * Respects world.sortFrameInterval to skip sorting on intermediate frames
 * (e.g. interval=2 sorts every other frame, reducing GPU cost for large counts).
 */
export function sortParticlesForRendering(world, cameraPos) {
  if (!world || !world.sortSystem || !cameraPos) return;
  
  // Sort frame interval: skip sort on non-interval frames (1 or 0 = every frame)
  const interval = world.sortFrameInterval || 1;
  if (interval > 1) {
    world._sortFrameCounter = ((world._sortFrameCounter || 0) + 1) % interval;
    if (world._sortFrameCounter !== 0) return;
  }
  
  executeRadixSort(
    world.sortSystem,
    world.device,
    world.activeParticleCount || world.maxParticles,
    cameraPos
  );
}

/**
 * Add a wire constraint between two particles.
 */
export function addParticleWire(world, particleA, particleB, restLength, stiffness = 0.5) {
  if (!world || !world.wireSystem) return -1;
  return addWireConstraint(world.wireSystem, world.device, particleA, particleB, restLength, stiffness);
}

// ============================================================================
// GPU ROPE CREATION (Phase 2 - Native GPU Ropes)
// ============================================================================

/**
 * Create a GPU-simulated rope with particles and constraints
 * @param {Object} world - Particle world
 * @param {Array<number>} startPos - [x, y, z] start position
 * @param {Array<number>} endPos - [x, y, z] end position
 * @param {number} segments - Number of rope segments
 * @param {Object} opts - Options { stiffness, fixStart, fixEnd, entityId, color, radius }
 * @returns {Object|null} { particleStart, particleCount, constraintStart, constraintCount }
 */
export function createGPURope(world, startPos, endPos, segments, opts = {}) {
  if (!world || !world.device || !world.ropeConstraintSystem) {
    console.warn("[ParticleSimWorld] Cannot create GPU chain - missing world or constraint system");
    return null;
  }
  
  const particleCount = segments + 1;
  
  // Reserve particles in the GPU backend
  const reservation = reserveParticles(world, particleCount, 'gpu');
  if (!reservation) {
    console.warn("[ParticleSimWorld] Failed to reserve particles for GPU chain");
    return null;
  }
  
  const { particleOffset: particleStart } = reservation;

  let ropeId = 0;
  if (Array.isArray(world._freeOwnerIds) && world._freeOwnerIds.length > 0) {
    ropeId = (world._freeOwnerIds.pop() | 0) >>> 0;
  }
  if (ropeId === 0) {
    ropeId = (world._nextOwnerId | 0) >>> 0;
    const next = ((ropeId + 1) | 0) >>> 0;
    world._nextOwnerId = (next === 0 || next > OWNER_LOCAL_MASK) ? 1 : next;
  }
  
  // Calculate initial positions along rope
  const dx = endPos[0] - startPos[0];
  const dy = endPos[1] - startPos[1];
  const dz = endPos[2] - startPos[2];
  const totalLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const segmentLength = totalLength / segments;
  
  // Create initial particle positions
  const initialPositions = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    initialPositions.push([
      startPos[0] + dx * t,
      startPos[1] + dy * t,
      startPos[2] + dz * t,
    ]);
  }
  
  // Upload initial positions to GPU
  uploadParticles(world, particleStart, initialPositions);
  
  // Initialize velocities to zero
  const zeroVelocities = initialPositions.map(() => [0, 0, 0]);
  uploadParticleVelocities(world, particleStart, zeroVelocities);

  if (world.ownerBuffer) {
    const owners = new Uint32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      owners[i] = (ropeId << OWNER_ID_SHIFT) | (i & OWNER_LOCAL_MASK);
    }
    updateBuffer(world.device, world.ownerBuffer, owners, particleStart * 4);
  }
  
  // Create constraints
  // When enableSprings is FALSE (default), use stiffness=1.0 for true inextensibility
  // When enableSprings is TRUE, use UI stiffness value for springy behavior
  const chainStiffness = opts.enableSprings ? (opts.stiffness || 0.9) : 1.0;
  
  const constraintResult = createRopeConstraints(
    world.ropeConstraintSystem,
    world.device,
    particleStart,
    particleCount,
    {
      restLength: segmentLength,
      chainStrength: opts.chainStrength ?? opts.breakForce ?? 0,
      particleMass: opts.particleMass ?? 1,
      stiffness: chainStiffness,
      chainStiffness: chainStiffness, // For GPU constraint solver
      fixStart: opts.fixStart,
      fixEnd: opts.fixEnd,
      startPos: opts.fixStart ? startPos : null,
      endPos: opts.fixEnd ? endPos : null,
      entityId: opts.entityId,
    }
  );
  
  // Register rope chain
  const ropeMetadata = {
    entityId: opts.entityId,
    backend: 'gpu',
    ropeId,
    particleStart,
    particleCount,
    constraintStart: constraintResult.constraintStart,
    constraintCount: constraintResult.constraintCount,
    startAttachment: constraintResult.startAttachment,
    endAttachment: constraintResult.endAttachment,
    color: opts.color || [0.6, 0.4, 0.2, 1],
    radius: opts.radius || 0.01,
  };
  
  world.ropeChains.push(ropeMetadata);
  if (opts.entityId != null) {
    world.ropesByEntity.set(opts.entityId, ropeMetadata);
  }
  
  // Auto-register for particle↔rope interaction (heat, moisture, burning, chain splitting)
  if (world.ropeInteractionSystem && opts.entityId != null) {
    const fiberMaterial = opts.fiberMaterial || 'hemp';
    registerRopeForInteraction(world.ropeInteractionSystem, opts.entityId, ropeMetadata, fiberMaterial);
  }
  
  console.log(`[ParticleSimWorld] Created GPU chain: ${particleCount} particles, ${constraintResult.constraintCount} constraints [${particleStart}-${particleStart + particleCount - 1}]`);
  
  return ropeMetadata;
}

/**
 * Upload particle velocities to GPU buffer
 * @param {Object} world - Particle world
 * @param {number} particleOffset - Start index
 * @param {Array<Array<number>>} velocities - Array of [vx, vy, vz]
 */
export function uploadParticleVelocities(world, particleOffset, velocities) {
  if (!world || !world.device || !world.velocityBuffer) return;
  if (!velocities || velocities.length === 0) return;
  
  const data = new Float32Array(velocities.length * 4);
  for (let i = 0; i < velocities.length; i++) {
    const vel = velocities[i];
    data[i * 4 + 0] = vel[0];
    data[i * 4 + 1] = vel[1];
    data[i * 4 + 2] = vel[2];
    data[i * 4 + 3] = 0;
  }
  
  const byteOffset = particleOffset * PARTICLE_STRIDE_BYTES;
  updateBuffer(world.device, world.velocityBuffer, data, byteOffset);
}

/**
 * Update attachment constraint target position
 * @param {Object} world - Particle world
 * @param {number} entityId - Rope entity ID
 * @param {string} which - 'start' or 'end'
 * @param {Array<number>} worldPos - New [x, y, z] position
 */
export function updateRopeAttachment(world, entityId, which, worldPos) {
  if (!world || !world.ropeConstraintSystem) return;
  
  const rope = world.ropesByEntity?.get(entityId);
  if (!rope) return;
  
  const constraintIdx = which === 'start' ? rope.startAttachment : rope.endAttachment;
  if (constraintIdx >= 0) {
    updateAttachmentTarget(world.ropeConstraintSystem, world.device, constraintIdx, worldPos);
  }
}

/**
 * Destroy a GPU rope and release its resources
 * @param {Object} world - Particle world
 * @param {number} entityId - Entity ID of the rope
 */
export function destroyGPURope(world, entityId) {
  if (!world) return;
  
  // Unregister from interaction system
  if (world.ropeInteractionSystem && entityId != null) {
    unregisterRopeInteraction(world.ropeInteractionSystem, entityId);
  }
  
  // Clear constraints
  if (world.ropeConstraintSystem) {
    clearRopeConstraints(world.ropeConstraintSystem, entityId);
  }
  
  // Unregister rope chain (releases particle reservation)
  unregisterRopeChain(world, entityId);
}

/**
 * Add an SDF collider to the particle system.
 */
export function addParticleCollider(world, type, center, radius, halfExtents) {
  if (!world || !world.sdfSystem) return -1;
  return addSDFCollider(world.sdfSystem, world.device, type, center, radius, halfExtents);
}

/**
 * Clear all SDF colliders (call before per-frame rebuild).
 */
export function clearParticleColliders(world) {
  if (!world || !world.sdfSystem) return;
  clearSDFColliders(world.sdfSystem);
}

/**
 * Batch-rebuild SDF colliders from an array of descriptors.
 * Call each frame with entity SDF shapes for proper mesh collision.
 * @param {Object} world - Particle world
 * @param {Array<{type: string, center: number[], radius: number, halfExtents: number[]}>} colliders
 */
export function rebuildParticleColliders(world, colliders) {
  if (!world || !world.sdfSystem || !colliders) return;
  rebuildSDFColliders(world.sdfSystem, world.device, colliders);
}

/**
 * Seed particles on GPU with random positions/velocities.
 */
export function seedParticles(world, count, options = {}) {
  if (!world || !world.seedingSystem) return;
  seedParticlesGPU(world.seedingSystem, world.device, count, options);
}

/**
 * Set texture atlas sprite assignment mode.
 */
export function setParticleAtlasMode(world, mode) {
  if (!world || !world.atlasSystem) return;
  setAssignmentMode(world.atlasSystem, mode);
}

// ============================================================================
// SNAPSHOT / TIME REWIND SYSTEM
// ============================================================================

/**
 * Initialize snapshot system for time rewind.
 * @param {Object} world - Particle world
 * @param {Object} options - { historySeconds, snapshotRate }
 */
export function initSnapshotSystem(world, options = {}) {
  if (!world || !world.device) return false;
  
  world.snapshotSystem = createSnapshotSystem(world.device, world.maxParticles, options);
  initSnapshotBindGroups(
    world.snapshotSystem,
    world.positionBuffer,
    world.velocityBuffer,
    world.metaBuffer,
    world.thermalBuffer
  );
  
  console.log(`[ParticleSimWorld] Snapshot system initialized`);
  return true;
}

/**
 * Auto-capture snapshots during simulation (call each frame).
 */
export function updateSnapshots(world, emitters, currentTimeMs) {
  if (!world || !world.snapshotSystem) return;
  autoSnapshot(world.snapshotSystem, emitters, currentTimeMs);
}

/**
 * Manually take a snapshot.
 */
export function captureSnapshot(world, emitters, currentTimeMs) {
  if (!world || !world.snapshotSystem) return;
  takeSnapshot(world.snapshotSystem, emitters, currentTimeMs);
}

/**
 * Start time rewind mode.
 */
export function beginRewind(world) {
  if (!world || !world.snapshotSystem) return false;
  return startRewind(world.snapshotSystem);
}

/**
 * Stop time rewind and resume simulation.
 */
export function endRewind(world) {
  if (!world || !world.snapshotSystem) return;
  stopRewind(world.snapshotSystem);
}

/**
 * Step rewind playback (call each frame while rewinding).
 */
export function updateRewind(world, emitters, dt) {
  if (!world || !world.snapshotSystem) return;
  stepRewind(world.snapshotSystem, emitters, dt);
}

/**
 * Seek to a specific time in history.
 */
export function rewindToTime(world, emitters, targetTimeMs) {
  if (!world || !world.snapshotSystem) return false;
  return seekToTime(world.snapshotSystem, emitters, targetTimeMs);
}

/**
 * Restore a specific frame from history.
 */
export function rewindToFrame(world, emitters, frameIndex) {
  if (!world || !world.snapshotSystem) return false;
  return restoreFrame(world.snapshotSystem, emitters, frameIndex);
}

/**
 * Set rewind playback speed (-1 = reverse, 1 = forward, 0.5 = slow, etc.)
 */
export function setRewindSpeed(world, speed) {
  if (!world || !world.snapshotSystem) return;
  setPlaybackSpeed(world.snapshotSystem, speed);
}

/**
 * Get snapshot/rewind status info.
 */
export function getRewindInfo(world) {
  if (!world || !world.snapshotSystem) return null;
  return getSnapshotInfo(world.snapshotSystem);
}

/**
 * Check if currently in rewind mode.
 */
export function isRewinding(world) {
  return world?.snapshotSystem?.isRewinding ?? false;
}

/**
 * Clear all snapshot history.
 */
export function clearSnapshots(world) {
  if (!world || !world.snapshotSystem) return;
  clearHistory(world.snapshotSystem);
}

/**
 * Update adaptive quality based on frame time.
 * Automatically adjusts activeParticleCount to maintain target FPS.
 * 
 * TECHNIQUES FROM AAA GAME INDUSTRY (DRS Best Practices):
 * 1. Frame-rate independent exponential smoothing
 * 2. Spike filtering - only reduce after sustained poor performance
 * 3. Panic mode - aggressive drop when critically over budget  
 * 4. Fast recovery - don't be over-cautious when headroom exists
 * 5. Proportional response - bigger adjustments when further from target
 * 6. Target slightly under budget for safety margin
 */
export function updateAdaptiveQuality(world, frameTimeMs) {
  if (!world || !world.adaptiveQuality) {
    return;
  }
  
  // Target slightly UNDER budget for safety margin (industry best practice)
  // For 60fps (16.67ms), target ~15.5ms to avoid dropped frames
  const targetMs = (1000 / world.targetFps) * 0.93;
  const budgetMs = 1000 / world.targetFps;  // Actual frame budget
  const dt = frameTimeMs / 1000;
  
  // Initialize state if needed
  if (world._badFrameTime === undefined) {
    world._badFrameTime = 0;
    world._goodFrameTime = 0;
    world._panicMode = false;
  }
  
  // Frame-rate independent EMA (rate 5 = responsive but filters noise)
  const emaRate = 5.0;
  const emaAlpha = 1 - Math.exp(-emaRate * dt);
  world.frameMsEma = world.frameMsEma + (frameTimeMs - world.frameMsEma) * emaAlpha;
  
  // Thresholds
  const highThreshold = targetMs * 1.10;   // 10% over target = reduce
  const lowThreshold = targetMs * 0.80;    // 20% under target = increase
  const panicThreshold = budgetMs * 1.25;  // 25% over BUDGET = panic mode
  
  // Spike detection windows
  const spikeWindow = 0.25;     // 250ms sustained bad = reduce
  const recoveryWindow = 0.15;  // 150ms sustained good = increase (FASTER recovery)
  const panicWindow = 0.1;      // 100ms critically over = panic
  
  // Track sustained performance
  if (frameTimeMs > panicThreshold) {
    // CRITICAL - entering panic territory
    world._badFrameTime += dt * 2;  // Accumulate faster
    world._goodFrameTime = 0;
    world._panicMode = world._badFrameTime > panicWindow;
  } else if (frameTimeMs > highThreshold) {
    // Over budget - accumulate bad time
    world._badFrameTime += dt;
    world._goodFrameTime = 0;
    world._panicMode = false;
  } else if (frameTimeMs < lowThreshold) {
    // Under budget - accumulate good time, decay bad quickly
    world._goodFrameTime += dt;
    world._badFrameTime = Math.max(0, world._badFrameTime - dt * 3);
    world._panicMode = false;
  } else {
    // In safe zone - decay both counters
    world._badFrameTime = Math.max(0, world._badFrameTime - dt);
    world._goodFrameTime = Math.max(0, world._goodFrameTime - dt * 0.5);
    world._panicMode = false;
  }
  
  // Calculate proportional response (bigger adjustment when further from target)
  const overshoot = Math.max(0, (world.frameMsEma - targetMs) / targetMs);
  const undershoot = Math.max(0, (targetMs - world.frameMsEma) / targetMs);
  
  // PANIC MODE: Aggressive quality drop to avoid frame drops
  if (world._panicMode) {
    const panicRate = 8.0;  // Very fast drop
    const alpha = 1 - Math.exp(-panicRate * dt);
    world.qualityScale = world.qualityScale + (world.config.qualityScaleMin - world.qualityScale) * alpha;
  }
  // Normal reduction after sustained poor performance
  else if (world._badFrameTime > spikeWindow && world.frameMsEma > highThreshold) {
    // Proportional rate: 2.0 base + up to 3.0 more based on overshoot
    const decreaseRate = 2.0 + overshoot * 3.0;
    const alpha = 1 - Math.exp(-decreaseRate * dt);
    world.qualityScale = world.qualityScale + (world.config.qualityScaleMin - world.qualityScale) * alpha;
  }
  // FAST RECOVERY when sustained good performance (don't under-utilize GPU)
  else if (world._goodFrameTime > recoveryWindow && world.frameMsEma < lowThreshold) {
    // Proportional rate: 1.5 base + up to 2.5 more based on undershoot
    const increaseRate = 1.5 + undershoot * 2.5;
    const alpha = 1 - Math.exp(-increaseRate * dt);
    world.qualityScale = world.qualityScale + (world.config.qualityScaleMax - world.qualityScale) * alpha;
  }
  
  // Clamp to valid range
  world.qualityScale = Math.max(world.config.qualityScaleMin, 
                                Math.min(world.config.qualityScaleMax, world.qualityScale));
  
  // Update active particle count
  world.activeParticleCount = Math.floor(world.maxParticles * world.qualityScale);
}

/**
 * Get particle system stats for performance overlay.
 */
export function getParticleStats(world) {
  if (!world) {
    return null;
  }
  
  return {
    maxParticles: world.maxParticles,
    activeParticles: world.activeParticleCount,
    qualityScale: world.qualityScale,
    frameMsEma: world.frameMsEma,
    targetFps: world.targetFps,
    panicMode: world._panicMode || false,  // Debug: shows if in panic mode
    gridDims: world.gridDims || 0,
    maxLines: world.maxLines || 0,
    showLines: world.showLines,
    showParticles: world.showParticles,
    connectionDistance: world.connectionDistance,
  };
}

/**
 * Get or create a reusable staging buffer for GPU readback (reduce allocations)
 * @param {Object} world - Particle world
 * @param {number} byteSize - Required size in bytes
 * @returns {GPUBuffer} - Staging buffer
 */
function getOrCreateStagingBuffer(world, key, byteSize) {
  const stagingMap = world._readbackStagingBuffers || (world._readbackStagingBuffers = new Map());
  const entry = stagingMap.get(key);
  
  // Reuse existing staging buffer if large enough
  if (entry && entry.buffer && entry.size >= byteSize) {
    return entry.buffer;
  }
  
  // Destroy old buffer if exists
  if (entry && entry.buffer) {
    entry.buffer.destroy();
  }
  
  // Create new staging buffer (recycle on next call)
  const buffer = world.device.createBuffer({
    label: `ParticleSimWorld.readbackStaging.${String(key)}`,
    size: byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  stagingMap.set(key, { buffer, size: byteSize });
  
  return buffer;
}

/**
 * Generic GPU buffer readback to CPU array (reusable for any buffer type)
 * @param {Object} world - Particle world
 * @param {GPUBuffer} sourceBuffer - GPU buffer to read from
 * @param {Float32Array} targetArray - CPU array to write into
 * @param {number} particleCount - Number of particles to read
 * @returns {Promise<boolean>} - True if successful
 */
async function readbackBufferFromGPU(world, sourceBuffer, targetArray, particleCount, key = 'default') {
  if (!world || !world.device || !sourceBuffer || !targetArray) {
    return false;
  }
  
  const inFlight = world._readbackInFlight || (world._readbackInFlight = new Map());
  if (inFlight.has(key)) {
    return false; // Skip if previous readback for this key is still pending
  }
  let release = null;
  const done = new Promise(r => { release = r; });
  inFlight.set(key, done);
  
  const byteSize = Math.min(particleCount * 16, targetArray.byteLength);
  const stagingBuffer = getOrCreateStagingBuffer(world, key, byteSize);
  
  const encoder = world.device.createCommandEncoder({ label: "ParticleSimWorld.readbackEncoder" });
  encoder.copyBufferToBuffer(sourceBuffer, 0, stagingBuffer, 0, byteSize);
  world.device.queue.submit([encoder.finish()]);
  
  let mapped = false;
  try {
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    // A reusable staging allocation may be larger than this bounded request.
    // Map only the bytes copied for this sample so targetArray.set() cannot see
    // stale trailing elements from an earlier, larger readback.
    const mappedData = new Float32Array(stagingBuffer.getMappedRange(0, byteSize));
    targetArray.set(mappedData);
    stagingBuffer.unmap();
    return true;
  } catch (err) {
    if (mapped) {
      try { stagingBuffer.unmap(); } catch (e) {}
    }
    console.warn('[ParticleSimWorld] GPU readback failed:', err);
    return false;
  } finally {
    if (release) release();
    if (inFlight.get(key) === done) {
      inFlight.delete(key);
    }
  }
}

export async function readbackPositionsFromGPU(world, targetPositions, particleCount) {
  return readbackBufferFromGPU(world, world?.positionBuffer, targetPositions, particleCount, 'positions');
}

export async function readbackVelocitiesFromGPU(world, targetVelocities, particleCount) {
  return readbackBufferFromGPU(world, world?.velocityBuffer, targetVelocities, particleCount, 'velocities');
}

export async function readbackThermalFromGPU(world, targetThermal, particleCount) {
  return readbackBufferFromGPU(world, world?.thermalBuffer, targetThermal, particleCount, 'thermal');
}

/**
 * Attach a fluid world to the particle simulation.
 * Particles will sample and follow the fluid velocity field.
 */
export function attachFluidWorld(particleWorld, fluidWorld, worldMin, worldMax) {
  if (!particleWorld || !particleWorld.device) {
    return;
  }
  if (!fluidWorld || !fluidWorld.velocityBuffer) {
    // Detach fluid
    particleWorld.attachedFluidWorld = null;
    particleWorld.fluidWorldMin = null;
    particleWorld.fluidWorldMax = null;
    return;
  }

  particleWorld.attachedFluidWorld = fluidWorld;
  particleWorld.fluidWorldMin = worldMin || [-1e9, -1e9, -1e9];
  particleWorld.fluidWorldMax = worldMax || [1e9, 1e9, 1e9];

  particleWorld.fluidBindGroup = particleWorld.bindGroupsFluid.get({
    fluidVelocity: fluidWorld.velocityBuffer,
    fluidParams: particleWorld.fluidParamsBuffer,
  }, "ParticleSimWorld.fluidBindGroup.attached");
}

export function stepParticleSimWorld(world, deltaSeconds, options = {}) {
  if (!world || !world.device || !world.pipeline || !world.bindGroup) {
    return;
  }

  const device = world.device;
  const dt = Number(deltaSeconds);
  if (!Number.isFinite(dt) || dt <= 0) {
    return;
  }

  const particleCountOption = options.particleCount;
  const particleCountRaw =
    typeof particleCountOption === "number" && Number.isFinite(particleCountOption)
      ? particleCountOption
      : world.maxParticles;
  let particleCount = particleCountRaw | 0;
  if (particleCount < 0) {
    particleCount = 0;
  }
  if (particleCount > world.maxParticles) {
    particleCount = world.maxParticles;
  }
  if (particleCount === 0) {
    return;
  }

  const baseIndexOption = options.baseIndex;
  const baseIndexRaw =
    typeof baseIndexOption === "number" && Number.isFinite(baseIndexOption)
      ? baseIndexOption
      : 0;
  let baseIndex = baseIndexRaw | 0;
  if (baseIndex < 0) {
    baseIndex = 0;
  }
  if (baseIndex >= world.maxParticles) {
    return;
  }
  const remainingCount = (world.maxParticles - baseIndex) | 0;
  if (particleCount > remainingCount) {
    particleCount = remainingCount;
  }
  if (particleCount <= 0) {
    return;
  }

  let paramsDataF32 = world._paramsDataF32;
  let paramsDataU32 = world._paramsDataU32;
  if (!paramsDataF32 || !paramsDataU32 || paramsDataF32.length < 12) {
    const paramsDataBuffer = new ArrayBuffer(48);
    paramsDataF32 = new Float32Array(paramsDataBuffer);
    paramsDataU32 = new Uint32Array(paramsDataBuffer);
    world._paramsDataBuffer = paramsDataBuffer;
    world._paramsDataF32 = paramsDataF32;
    world._paramsDataU32 = paramsDataU32;
  }

  paramsDataF32[0] = dt;
  paramsDataU32[1] = particleCount >>> 0;

  // Room half size for simple AABB collisions in compute shader.
  // If not provided, fall back to a reasonable default (25, matching ROOM_SIZE / 2 in tests).
  const roomHalfSizeOption = options.roomHalfSize;
  let roomHalfSize = 1e9; // Infinite by default
  if (typeof roomHalfSizeOption === "number" && Number.isFinite(roomHalfSizeOption)) {
    if (roomHalfSizeOption > 0) {
      roomHalfSize = roomHalfSizeOption;
    }
  }

  const gridBoundsHalfSizeOption = options.gridBoundsHalfSize;
  let gridBoundsHalfSize = null;
  if (typeof gridBoundsHalfSizeOption === "number" && Number.isFinite(gridBoundsHalfSizeOption) && gridBoundsHalfSizeOption > 0) {
    gridBoundsHalfSize = gridBoundsHalfSizeOption;
  } else if (typeof roomHalfSizeOption === "number" && Number.isFinite(roomHalfSizeOption) && roomHalfSizeOption > 0) {
    gridBoundsHalfSize = roomHalfSizeOption;
  }
  const hasGridBounds = gridBoundsHalfSize != null;

  // Gravity Y (world-space). If not provided, use a mild default downward gravity.
  const gravityYOption = options.gravityY;
  let gravityY = -4.9; // half of Earth gravity for a softer feel
  if (typeof gravityYOption === "number" && Number.isFinite(gravityYOption)) {
    gravityY = gravityYOption;
  }

  paramsDataF32[2] = hasGridBounds ? gridBoundsHalfSize : roomHalfSize;
  paramsDataF32[3] = gravityY;
  paramsDataU32[4] = baseIndex >>> 0;
  paramsDataU32[5] = 0;
  paramsDataU32[6] = 0;
  paramsDataU32[7] = 0;
  // frameSeed: deterministic per-frame seed for GPU particle RNG (collab sync)
  const frameSeedOption = options.frameSeed;
  paramsDataU32[8] = typeof frameSeedOption === 'number' ? (frameSeedOption >>> 0) : 0;
  paramsDataU32[9] = 0;
  paramsDataU32[10] = 0;
  paramsDataU32[11] = 0;

  const enableGridCollisions = options.enableGridCollisions !== false;
  if (enableGridCollisions && hasGridBounds) {
    if (!world.gridCountsBuffer || !world.gridIndicesBuffer) {
      initAdvancedParticleBuffers(world);
    }

    const gridDims = world.gridDims | 0;
    const cellCap = world.cellCap | 0;
    const ropeSkipOption = options.ropeSelfCollisionSkip;
    const ropeSkipRaw =
      typeof ropeSkipOption === "number" && Number.isFinite(ropeSkipOption)
        ? (ropeSkipOption | 0)
        : 2;
    const ropeSkip = Math.max(0, Math.min(ropeSkipRaw, OWNER_LOCAL_MASK)) | 0;

    if (
      gridDims > 0 &&
      cellCap > 0 &&
      world.gridCountsBuffer &&
      world.gridIndicesBuffer &&
      initGridCollisionSystem(world)
    ) {
      paramsDataU32[5] = gridDims >>> 0;
      paramsDataU32[6] = cellCap >>> 0;
      paramsDataU32[7] = ropeSkip >>> 0;
    }
  }

  updateBuffer(device, world.paramsBuffer, paramsDataF32, 0);

  // Update collider params (collider count) if collider buffers are available.
  if (world.colliderParamsBuffer) {
    const colliderCountOption = options.colliderCount;
    const colliderCountRaw =
      typeof colliderCountOption === "number" && Number.isFinite(colliderCountOption)
        ? colliderCountOption
        : 0;
    let colliderCount = colliderCountRaw | 0;
    if (colliderCount < 0) {
      colliderCount = 0;
    }
    if (world.maxColliders && colliderCount > world.maxColliders) {
      colliderCount = world.maxColliders;
    }

    const colliderParamsData = world._colliderParamsData || (world._colliderParamsData = new Float32Array(4));
    colliderParamsData[0] = colliderCount;
    colliderParamsData[1] = 0;
    colliderParamsData[2] = 0;
    colliderParamsData[3] = 0;
    updateBuffer(device, world.colliderParamsBuffer, colliderParamsData, 0);
  }

  // Update fluid params
  if (world.fluidParamsBuffer) {
    const fluidParamsData = world._fluidParamsData || (world._fluidParamsData = new Float32Array(12));
    const fluidWorld = world.attachedFluidWorld;
    const fluidInfluence = typeof options.fluidInfluence === "number" ? options.fluidInfluence : 2.0;

    if (fluidWorld && fluidWorld.velocityBuffer) {
      // Fluid is attached - enable sampling
      fluidParamsData[0] = fluidWorld.gridSizeX || 1;
      fluidParamsData[1] = fluidWorld.gridSizeY || 1;
      fluidParamsData[2] = fluidWorld.gridSizeZ || 1;
      fluidParamsData[3] = 1.0; // fluidEnabled

      const wMin = world.fluidWorldMin || [-1e9, -1e9, -1e9];
      const wMax = world.fluidWorldMax || [1e9, 1e9, 1e9];
      fluidParamsData[4] = wMin[0];
      fluidParamsData[5] = wMin[1];
      fluidParamsData[6] = wMin[2];
      fluidParamsData[7] = 0; // pad

      fluidParamsData[8] = wMax[0];
      fluidParamsData[9] = wMax[1];
      fluidParamsData[10] = wMax[2];
      fluidParamsData[11] = fluidInfluence;
    } else {
      // No fluid attached - disable
      fluidParamsData[3] = 0.0; // fluidEnabled = 0
    }

    updateBuffer(device, world.fluidParamsBuffer, fluidParamsData, 0);
  }

  // Update force params (wind, turbulence, vortex, force points)
  if (world.forceParamsBuffer) {
    const fpData = world._forceParamsData || (world._forceParamsData = new Float32Array(24));
    const fpU32 = world._forceParamsU32 || (world._forceParamsU32 = new Uint32Array(fpData.buffer));

    // Read from attached windSystem or manual options
    const ws = options.windSystem || world.attachedWindSystem;
    const wind = options.wind || {};
    const turb = options.turbulence || {};
    const vortex = options.vortex || {};

    // Wind direction (normalized) — from WindSystem or manual
    if (ws && ws.windVector) {
      const wv = ws.windVector;
      const wLen = Math.sqrt(wv[0] * wv[0] + (wv[1] || 0) * (wv[1] || 0) + (wv[2] || 0) * (wv[2] || 0)) || 1;
      fpData[0] = wv[0] / wLen;     // windDir.x
      fpData[1] = (wv[1] || 0) / wLen; // windDir.y
      fpData[2] = (wv[2] || 0) / wLen; // windDir.z
      fpData[3] = ws.speed || 0;     // windStrength
      fpData[4] = ws.gustPhase || 0; // gustPhase
      fpData[5] = ws.gustStrength || 0; // gustStrength
    } else {
      const windDir = wind.direction || [0, 0, 0];
      fpData[0] = windDir[0] || 0;
      fpData[1] = windDir[1] || 0;
      fpData[2] = windDir[2] || 0;
      fpData[3] = wind.strength || 0;
      fpData[4] = wind.gustPhase || 0;
      fpData[5] = wind.gustStrength || 0;
    }

    // Turbulence — from WindSystem or manual
    fpData[6] = turb.strength ?? (ws ? ws.turbulence || 0 : 0);
    fpData[7] = turb.scale ?? 2.0;
    fpData[8] = turb.speed ?? 0.1;
    fpU32[9] = (turb.octaves ?? 1) >>> 0;

    // Force point count
    const fps = getForcePoints();
    fpU32[10] = Math.min(fps.length, 16) >>> 0;

    // Max velocity
    fpData[11] = options.maxVelocity ?? 100.0;

    // Vortex
    const vPos = vortex.position || [0, 0, 0];
    fpData[12] = vPos[0] || 0;
    fpData[13] = vPos[1] || 0;
    fpData[14] = vPos[2] || 0;
    fpData[15] = vortex.strength || 0;
    const vAxis = vortex.axis || [0, 1, 0];
    fpData[16] = vAxis[0] || 0;
    fpData[17] = vAxis[1] || 1;
    fpData[18] = vAxis[2] || 0;
    fpData[19] = vortex.radius || 5.0;

    // Size-based gravity: bigger particles fall faster (0 = disabled)
    fpData[20] = options.sizeGravityScale ?? world.sizeGravityScale ?? 0.0;
    // Sort frame interval (0 or 1 = every frame)
    fpU32[21] = (options.sortFrameInterval ?? world.sortFrameInterval ?? 1) >>> 0;
    fpData[22] = 0; // _fpPad0
    fpData[23] = 0; // _fpPad1

    updateBuffer(device, world.forceParamsBuffer, fpData, 0);

    // Upload force points to GPU
    if (fps.length > 0) {
      const fpBuf = world._forcePointsData || (world._forcePointsData = new Float32Array(16 * 4));
      const count = Math.min(fps.length, 16);
      for (let fi = 0; fi < count; fi++) {
        const fp = fps[fi];
        fpBuf[fi * 4 + 0] = fp.x || 0;
        fpBuf[fi * 4 + 1] = fp.y || 0;
        fpBuf[fi * 4 + 2] = fp.z || 0;
        fpBuf[fi * 4 + 3] = fp.strength || 0;
      }
      updateBuffer(device, world.forcePointsBuffer, fpBuf, 0);
    }
  }

  // Zero event counter (preserve maxEvents in slot [1])
  if (world.eventCounterBuffer) {
    device.queue.writeBuffer(world.eventCounterBuffer, 0, new Uint32Array([0]));
  }

  const externalEncoder = options && options.encoder ? options.encoder : null;
  const encoder = externalEncoder || device.createCommandEncoder({
    label: "ParticleSimWorld.step.encoder",
  });

  // Run alive list scan FIRST so the compact alive list is ready for the main sim
  // This builds aliveList[], sets aliveCount, and writes aliveDispatchArgs
  if (world.indirectSystem && world.indirectSystem.scanBindGroup) {
    executeIndirectScan(world.indirectSystem, device, { encoder });
  }
  const pass = encoder.beginComputePass({
    label: "ParticleSimWorld.step.pass",
  });

  pass.setPipeline(world.pipeline);
  pass.setBindGroup(0, world.bindGroup);
  pass.setBindGroup(1, world.fluidBindGroup);
  pass.setBindGroup(2, world.forceBindGroup);
  pass.setBindGroup(3, world.noiseBindGroup);

  // Use alive-count indirect dispatch when available (dispatches only aliveCount threads)
  // Falls back to CPU-driven dispatch when indirect system is not active
  const workgroupCount = Math.ceil(particleCount / world.workgroupSize);
  if (world.indirectSystem && world.indirectSystem.aliveDispatchBuffer) {
    pass.dispatchWorkgroupsIndirect(world.indirectSystem.aliveDispatchBuffer, 0);
  } else {
    pass.dispatchWorkgroups(workgroupCount);
  }
  pass.end();

  // Grid collision still dispatches over slot range (has its own dead early-out)
  if (world.gridCollisionSystem && paramsDataU32[5] !== 0) {
    const gridDims = paramsDataU32[5] >>> 0;
    const cellCount = gridDims * gridDims * gridDims;

    const gridPass = encoder.beginComputePass({
      label: "ParticleSimWorld.gridCollision.pass",
    });

    gridPass.setBindGroup(0, world.gridCollisionSystem.bindGroup);

    gridPass.setPipeline(world.gridCollisionSystem.clearGrid);
    gridPass.dispatchWorkgroups(Math.ceil(cellCount / world.workgroupSize));

    gridPass.setPipeline(world.gridCollisionSystem.binParticles);
    gridPass.dispatchWorkgroups(workgroupCount);

    // Use shared-memory collide when available (cell-centric dispatch, ~2-5× faster)
    if (world.gridCollisionSystem.useSharedMem && world.gridCollisionSystem.sharedMemCollide) {
      dispatchSharedMemCollide(world.gridCollisionSystem.sharedMemCollide, world.gridCollisionSystem.bindGroup, gridPass, gridDims);
    } else {
      gridPass.setPipeline(world.gridCollisionSystem.collide);
      gridPass.dispatchWorkgroups(workgroupCount);
    }

    gridPass.end();
  }

  if (!externalEncoder) {
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }
  return { encoded: true, submitted: !externalEncoder, particleCount, baseIndex };
}

// ============================================================================
// LINE RENDERING PIPELINE
// ============================================================================

/**
 * Create line rendering pipeline for particle connections
 */
export function createLineRenderPipeline(device, format) {
  if (!device) return null;
  
  const shaderModule = device.createShaderModule({
    label: "ParticleLines.shader",
    code: LINE_RENDER_SHADER,
  });
  
  const pipeline = device.createRenderPipeline({
    label: "ParticleLines.pipeline",
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [{
        arrayStride: 32, // vec4 pos + vec4 color
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },  // position
          { shaderLocation: 1, offset: 16, format: "float32x4" }, // color
        ],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        },
      }],
    },
    primitive: {
      topology: "line-list",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });
  
  return pipeline;
}

/**
 * Create line compute pipelines for spatial grid and line generation
 */
export function createLineComputePipelines(device) {
  if (!device) return null;
  
  const shaderModule = device.createShaderModule({
    label: "ParticleLineCompute.shader",
    code: LINE_COMPUTE_SHADER,
  });
  
  const clearGridPipeline = device.createComputePipeline({
    label: "ParticleLines.clearGrid",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "clearGrid" },
  });
  
  const clearCountersPipeline = device.createComputePipeline({
    label: "ParticleLines.clearCounters",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "clearCounters" },
  });
  
  const binParticlesPipeline = device.createComputePipeline({
    label: "ParticleLines.binParticles",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "binParticles" },
  });
  
  const generateLinesPipeline = device.createComputePipeline({
    label: "ParticleLines.generateLines",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "generateLines" },
  });
  
  return {
    clearGrid: clearGridPipeline,
    clearCounters: clearCountersPipeline,
    binParticles: binParticlesPipeline,
    generateLines: generateLinesPipeline,
    shaderModule,
  };
}

/**
 * Create line uniform buffer for compute and render
 */
export function createLineUniformBuffer(device) {
  // SimUniforms struct size: 112 bytes (aligned)
  const buffer = createUniformBuffer(device, 128, {
    label: "ParticleLines.uniforms",
  });
  return buffer;
}

/**
 * Initialize complete line rendering system
 */
export function initLineRenderingSystem(world, format) {
  if (!world || !world.device) return false;
  
  const device = world.device;
  
  // Create pipelines
  world.lineRenderPipeline = createLineRenderPipeline(device, format);
  world.lineComputePipelines = createLineComputePipelines(device);
  world.lineUniformBuffer = createLineUniformBuffer(device);
  
  // Create bind group for line compute
  if (world.lineComputePipelines && world.gridCountsBuffer && world.gridIndicesBuffer) {
    world.lineComputeBindGroup = device.createBindGroup({
      label: "ParticleLines.computeBindGroup",
      layout: world.lineComputePipelines.clearGrid.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: world.lineUniformBuffer } },
        { binding: 1, resource: { buffer: world.positionBuffer } },
        { binding: 2, resource: { buffer: world.velocityBuffer } },
        { binding: 3, resource: { buffer: world.gridCountsBuffer } },
        { binding: 4, resource: { buffer: world.gridIndicesBuffer } },
        { binding: 5, resource: { buffer: world.lineVertexBuffer } },
        { binding: 6, resource: { buffer: world.drawIndirectBuffer } },
      ],
    });
    
    // Create bind group for line render
    world.lineRenderBindGroup = device.createBindGroup({
      label: "ParticleLines.renderBindGroup",
      layout: world.lineRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: world.lineUniformBuffer } },
      ],
    });
  }
  
  console.log("[ParticleSimWorld] Line rendering system initialized");
  return true;
}

/**
 * Execute line generation compute passes
 */
export function stepLineGeneration(world, options = {}) {
  if (!world || !world.lineComputePipelines || !world.lineComputeBindGroup) return;
  if (!world.showLines) return;
  
  const device = world.device;
  const particleCount = options.particleCount || world.activeParticleCount || 0;
  if (particleCount === 0) return;
  
  const gridDims = world.gridDims || 64;
  const cellCount = gridDims * gridDims * gridDims;
  const bounds = options.bounds || 1e9;
  const cellSize = (bounds * 2) / gridDims;
  
  // Update uniforms - reuse buffer to avoid allocations
  const uniformData = world._lineUniformData || (world._lineUniformData = new Float32Array(32));
  // viewProj matrix (16 floats) - identity for now, will be set by render
  uniformData.fill(0); // Clear previous values
  uniformData[0] = 1; uniformData[5] = 1; uniformData[10] = 1; uniformData[15] = 1;
  // mouse (2 floats)
  uniformData[16] = options.mouseX || 0;
  uniformData[17] = options.mouseY || 0;
  // mouseActive (u32), particleCount (u32)
  const u32View = new Uint32Array(uniformData.buffer);
  u32View[18] = options.mouseActive ? 1 : 0;
  u32View[19] = particleCount;
  // bounds, cellSize, dt, connectionDistance
  uniformData[20] = bounds;
  uniformData[21] = cellSize;
  uniformData[22] = options.dt || 0.016;
  uniformData[23] = world.connectionDistance || 2.3;
  // gridDims (vec3<u32>), cellCap
  u32View[24] = gridDims;
  u32View[25] = gridDims;
  u32View[26] = gridDims;
  u32View[27] = world.cellCap || 16;
  // maxLineVertices, time, pad
  u32View[28] = world.maxLineVertices || (PARTICLE_CONFIG.maxLines * 2);
  uniformData[29] = options.time || 0;
  
  updateBuffer(device, world.lineUniformBuffer, uniformData, 0);
  
  const encoder = device.createCommandEncoder({ label: "ParticleLines.compute" });
  const pass = encoder.beginComputePass({ label: "ParticleLines.pass" });
  
  // Clear grid
  pass.setPipeline(world.lineComputePipelines.clearGrid);
  pass.setBindGroup(0, world.lineComputeBindGroup);
  pass.dispatchWorkgroups(Math.ceil(cellCount / 256));
  
  // Clear counters
  pass.setPipeline(world.lineComputePipelines.clearCounters);
  pass.dispatchWorkgroups(1);
  
  // Bin particles
  pass.setPipeline(world.lineComputePipelines.binParticles);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  
  // Generate lines
  pass.setPipeline(world.lineComputePipelines.generateLines);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Render particle connection lines
 */
export function renderParticleLines(world, pass, viewProj) {
  if (!world || !world.lineRenderPipeline || !world.lineVertexBuffer) return;
  if (!world.showLines) return;
  
  // Update viewProj in uniform buffer - reuse buffer if viewProj is already Float32Array
  if (viewProj && world.lineUniformBuffer) {
    const viewProjData = viewProj instanceof Float32Array ? viewProj : 
      (world._viewProjData || (world._viewProjData = new Float32Array(16)));
    if (!(viewProj instanceof Float32Array)) {
      viewProjData.set(viewProj);
    }
    updateBuffer(world.device, world.lineUniformBuffer, viewProj instanceof Float32Array ? viewProj : viewProjData, 0);
  }
  
  pass.setPipeline(world.lineRenderPipeline);
  pass.setBindGroup(0, world.lineRenderBindGroup);
  pass.setVertexBuffer(0, world.lineVertexBuffer);
  pass.drawIndirect(world.drawIndirectBuffer, 0);
}

// ============================================================================
// MOUSE INTERACTION
// ============================================================================

let mouseState = { x: 0, y: 0, active: false };

/**
 * Update mouse state for particle interaction
 */
export function updateMouseInteraction(ndcX, ndcY, active = true) {
  mouseState.x = ndcX;
  mouseState.y = ndcY;
  mouseState.active = active;
}

/**
 * Get current mouse state
 */
export function getMouseState() {
  return mouseState;
}

// ============================================================================
// FORCE POINTS (Attractors/Repellers)
// ============================================================================

const forcePoints = [];
const MAX_FORCE_POINTS = 16;

/**
 * Add an attractor or repeller force point
 * @param {Object} point - { x, y, z, strength } - negative strength = repel
 * @returns {number} Index of the force point
 */
export function addForcePoint(point) {
  if (forcePoints.length >= MAX_FORCE_POINTS) {
    console.warn("[ParticleSimWorld] Max force points reached");
    return -1;
  }
  forcePoints.push({
    x: point.x || 0,
    y: point.y || 0,
    z: point.z || 0,
    strength: point.strength || 1,
  });
  return forcePoints.length - 1;
}

/**
 * Remove a force point by index
 */
export function removeForcePoint(index) {
  if (index >= 0 && index < forcePoints.length) {
    forcePoints.splice(index, 1);
  }
}

/**
 * Clear all force points
 */
export function clearForcePoints() {
  forcePoints.length = 0;
}

/**
 * Get all force points
 */
export function getForcePoints() {
  return forcePoints;
}

/**
 * Update force point position
 */
export function updateForcePoint(index, x, y, z, strength) {
  if (index >= 0 && index < forcePoints.length) {
    const fp = forcePoints[index];
    if (x !== undefined) fp.x = x;
    if (y !== undefined) fp.y = y;
    if (z !== undefined) fp.z = z;
    if (strength !== undefined) fp.strength = strength;
  }
}

// ============================================================================
// WIND SYSTEM ATTACHMENT
// ============================================================================

/**
 * Attach a WindSystem instance to the particle world.
 * Once attached, stepParticleSimWorld will automatically read wind params each frame.
 * @param {Object} world - Particle world
 * @param {Object} windSystem - WindSystem instance (from engine/sim/world/WindSystem.js)
 */
export function attachWindSystem(world, windSystem) {
  if (!world) return;
  world.attachedWindSystem = windSystem || null;
}

/**
 * Detach wind system from particle world
 */
export function detachWindSystem(world) {
  if (!world) return;
  world.attachedWindSystem = null;
}

// ============================================================================
// KILL ZONES (Niagara parity: analytical shape bounds)
// ============================================================================

/**
 * Update kill zones for a particle world. Particles inside kill zones are killed.
 * @param {Object} world - Particle world
 * @param {Array<Object>} zones - Array of kill zone configs (up to 4):
 *   { type: 'box', center: [x,y,z], halfExtents: [hx,hy,hz], invert: false }
 *   { type: 'sphere', center: [x,y,z], radius: r, invert: false }
 *   { type: 'plane', normal: [nx,ny,nz], distance: d, invert: false }
 */
export function updateKillZones(world, zones) {
  if (!world?.killZoneBuffer || !world?.device) return;
  const data = new Float32Array(40); // 10 × vec4
  const count = Math.min(zones?.length || 0, 4);
  data[0] = count; // header: zone count

  for (let i = 0; i < count; i++) {
    const z = zones[i];
    const base = (1 + i * 2) * 4; // offset into flat array
    if (z.type === 'box') {
      data[base + 0] = z.center?.[0] ?? 0;
      data[base + 1] = z.center?.[1] ?? 0;
      data[base + 2] = z.center?.[2] ?? 0;
      data[base + 3] = 1.0; // type = box
      data[base + 4] = z.halfExtents?.[0] ?? 10;
      data[base + 5] = z.halfExtents?.[1] ?? 10;
      data[base + 6] = z.halfExtents?.[2] ?? 10;
      data[base + 7] = z.invert ? 1.0 : 0.0;
    } else if (z.type === 'sphere') {
      data[base + 0] = z.center?.[0] ?? 0;
      data[base + 1] = z.center?.[1] ?? 0;
      data[base + 2] = z.center?.[2] ?? 0;
      data[base + 3] = 2.0; // type = sphere
      data[base + 4] = z.radius ?? 10;
      data[base + 7] = z.invert ? 1.0 : 0.0;
    } else if (z.type === 'plane') {
      data[base + 0] = z.normal?.[0] ?? 0;
      data[base + 1] = z.normal?.[1] ?? 1;
      data[base + 2] = z.normal?.[2] ?? 0;
      data[base + 3] = 3.0; // type = plane
      data[base + 4] = z.distance ?? 0;
      data[base + 7] = z.invert ? 1.0 : 0.0;
    }
  }
  updateBuffer(world.device, world.killZoneBuffer, data, 0);
}

/**
 * Clear all kill zones
 */
export function clearKillZones(world) {
  updateKillZones(world, []);
}

// ============================================================================
// DISSOLVE EFFECTS
// ============================================================================

const dissolveStates = new Map();

/**
 * Start a dissolve effect for a particle group
 */
export function startDissolve(groupId, duration = 1.0, direction = 'out') {
  dissolveStates.set(groupId, {
    startTime: performance.now(),
    duration: duration * 1000,
    direction,
  });
}

/**
 * Get dissolve factor for a group (0 = invisible, 1 = fully visible)
 */
export function getDissolve(groupId) {
  const state = dissolveStates.get(groupId);
  if (!state) return 1;
  
  const elapsed = performance.now() - state.startTime;
  const t = Math.min(1, elapsed / state.duration);
  const factor = state.direction === 'in' ? t : 1 - t;
  
  // Clean up completed dissolves
  if (t >= 1) {
    dissolveStates.delete(groupId);
  }
  
  return factor;
}

// ============================================================================
// CURL NOISE FIELD
// ============================================================================

/**
 * Sample curl noise at a position (CPU version for debugging)
 */
export function sampleCurlNoise(x, y, z, scale = 1, time = 0) {
  const p = { x: x * scale + time, y: y * scale, z: z * scale };
  const e = 0.1;
  
  // Simplified noise function
  const noise = (px, py, pz) => {
    const n = Math.sin(px * 1.27 + py * 3.43) * Math.cos(pz * 2.17 + px * 0.97);
    return n * 0.5 + 0.5;
  };
  
  const n_x0 = noise(p.x - e, p.y, p.z);
  const n_x1 = noise(p.x + e, p.y, p.z);
  const n_y0 = noise(p.x, p.y - e, p.z);
  const n_y1 = noise(p.x, p.y + e, p.z);
  const n_z0 = noise(p.x, p.y, p.z - e);
  const n_z1 = noise(p.x, p.y, p.z + e);
  
  return {
    x: (n_y1 - n_y0) - (n_z1 - n_z0),
    y: (n_z1 - n_z0) - (n_x1 - n_x0),
    z: (n_x1 - n_x0) - (n_y1 - n_y0),
  };
}

// ============================================================================
// TRAIL SYSTEM
// ============================================================================

/**
 * Initialize trail history buffer for particles
 */
export function initTrailSystem(world, historyLength = 8) {
  if (!world || !world.device) return false;
  
  const device = world.device;
  const maxParticles = world.maxParticles;
  
  // Each history entry: vec4<f32> (x, y, z, alpha)
  const size = maxParticles * historyLength * 16;
  world.trailHistoryBuffer = createStorageBuffer(device, size, {
    label: "ParticleSimWorld.trailHistory",
  });
  world.trailHistoryLength = historyLength;
  
  labelResource(world.trailHistoryBuffer, "ParticleSimWorld.trailHistory");
  console.log(`[ParticleSimWorld] Trail system initialized: ${historyLength} history frames`);
  return true;
}

// ============================================================================
// SUB-EMITTER SYSTEM
// ============================================================================

const subEmitterConfigs = new Map();

/**
 * Register a sub-emitter configuration
 * @deprecated Use GPU event system instead: registerEventHandler(world.eventSystem, config)
 */
export function registerSubEmitter(parentType, config) {
  subEmitterConfigs.set(parentType, {
    event: config.event || 'death', // 'death', 'collision', 'lifetime'
    count: config.count || 3,
    speed: config.speed || 2,
    lifetime: config.lifetime || 0.5,
    size: config.size || 0.1,
    color: config.color || [1, 0.5, 0],
    spread: config.spread || 1,
  });
}

/**
 * Get sub-emitter config for a particle type
 */
export function getSubEmitterConfig(parentType) {
  return subEmitterConfigs.get(parentType);
}

/**
 * Clear all sub-emitter configs
 */
export function clearSubEmitters() {
  subEmitterConfigs.clear();
}

// Re-export GPU event system API for convenient access
export {
  registerEventHandler,
  onParticleEvent,
  offParticleEvent,
  readbackEvents,
  getLastEvents,
  enableEventSystem,
  disableEventSystem,
  EVENT_DEATH,
  EVENT_GROUND_COLLISION,
  EVENT_ENTITY_COLLISION,
  EVENT_KILL_ZONE,
  EVENT_MASK_ALL,
} from './ParticleEventSystem.js';

// Re-export GAP 10-16 APIs
export {
  createLifetimeCurvesSystem, setLifetimeCurves, destroyLifetimeCurvesSystem,
  curveFromLegacy3, CURVE_PRESETS,
} from './ParticleLifetimeCurves.js';
export {
  createVectorFieldSystem, generateProceduralVectorField, setVectorFieldParams,
  loadVectorFieldFromData, parseFGA, destroyVectorFieldSystem,
} from './ParticleVectorField.js';
export {
  createSDFAttractionSystem, addSDFAttractor, updateSDFAttractor,
  initSDFAttractionBindGroup, executeSDFAttraction,
  clearSDFAttractors, destroySDFAttractionSystem,
} from './ParticleSDFAttraction.js';

// Re-export GAP 19-26 APIs
export {
  createEmitterLOD, evaluateEmitterLOD, evaluateEmitterLODByScreenSize,
  getCurrentLODTier, setForcedLODTier, DEFAULT_LOD_TIERS,
} from './ParticleEmitterLOD.js';
export {
  createAdaptiveSubstepController, computeAdaptiveSubsteps,
  estimateMaxSpeedCPU, resetAdaptiveSubsteps,
} from './ParticleAdaptiveSubstep.js';
export {
  createAttributeReader, refreshAttributeCache, readParticlePosition,
  readParticleVelocity, readParticleMeta, findNearestParticle,
  findParticlesInRadius, destroyAttributeReader,
} from './ParticleAttributeReader.js';
export {
  createDecalSpawner, feedCollisionEvents, updateDecals,
  getActiveDecals, getDecalCount, clearDecals, destroyDecalSpawner,
} from './ParticleDecalSpawner.js';
export {
  createAudioBridge, registerAudioCue, processAudioEvents,
  flushPendingAudio, setAudioListenerPos, destroyAudioBridge,
} from './ParticleAudioBridge.js';
export {
  createNeighborGridSystem, initNeighborGridBindGroups,
  buildNeighborGrid, getNeighborGridBuffers, destroyNeighborGridSystem,
} from './ParticleNeighborGrid.js';

// Re-export GAP 27-32 APIs
export {
  createFlockingSystem, initFlockingBindGroups, setFlockingParams,
  executeFlocking, destroyFlockingSystem,
} from './ParticleFlocking.js';
export {
  createSplineFollowSystem, setSplineControlPoints, initSplineFollowBindGroups,
  setSplineFollowParams, executeSplineFollow, destroySplineFollowSystem,
} from './ParticleSplineFollow.js';
export {
  createSurfaceProjectionSystem, addProjectionSurface, initProjectionBindGroups,
  executeSurfaceProjection, clearProjectionSurfaces, destroySurfaceProjectionSystem,
} from './ParticleSurfaceProjection.js';
export {
  createLocalSpaceSystem, initLocalSpaceBindGroups, setEmitterTransform,
  setEmitterTransformFromPosRot, executeWorldToLocal, executeLocalToWorld,
  destroyLocalSpaceSystem,
} from './ParticleLocalSpace.js';
export {
  createSoftContainmentSystem, addContainmentVolume, initContainmentBindGroups,
  executeSoftContainment, clearContainmentVolumes, destroySoftContainmentSystem,
} from './ParticleSoftContainment.js';
export {
  createEulerianFluidSolver, initFluidBindGroups, addFluidSource,
  stepEulerianFluid, destroyEulerianFluidSolver,
} from './ParticleEulerianFluid.js';
// Re-export GAP 33-38 APIs
export {
  createElementTable, setParticleElements, setParticleCharges,
  destroyElementTable, getElement, getElementBySymbol, ELEMENTS,
  MOLECULE_PRESETS, ljMixingRule, ELEMENT_LUT_WGSL,
} from './ParticleElementTable.js';
export {
  createLennardJonesSystem, initLJBindGroups,
  executeLennardJones, destroyLennardJonesSystem,
} from './ParticleLennardJones.js';
export {
  createElectromagneticSystem, initEMBindGroups, setExternalField,
  executeElectromagnetic, destroyElectromagneticSystem,
} from './ParticleElectromagnetic.js';
export {
  createSPHSystem, initSPHBindGroups, setSPHParams,
  executeSPH, getSPHDensityBuffer, destroySPHSystem,
} from './ParticleSPH.js';
export {
  createNBodySystem, initNBodyBindGroups, setNBodyParams,
  executeNBody, destroyNBodySystem,
} from './ParticleNBody.js';
export {
  createFmmSystem, initFmmBindGroups, setFmmParams,
  executeFmm, readFmmDiagnostics, destroyFmmSystem,
} from './ParticleFMM.js';
export {
  createParticleMeshEwaldSystem, initParticleMeshEwaldBindGroups,
  setParticleMeshEwaldParams, executeParticleMeshEwald,
  readParticleMeshEwaldDiagnostics, destroyParticleMeshEwaldSystem,
} from './ParticleMeshEwald.js';
export * from './ParticleLongRangeMath.js';
export {
  createChemistrySystem, initChemistryBindGroups, initParticleValence,
  executeChemistry, getValenceBuffer, destroyChemistrySystem,
} from './ParticleChemistry.js';

// Re-export ParticleClassifier APIs (fluid visual classification)
export {
  createClassifierSystem, initClassifierBindGroups, executeClassifier,
  getClassificationBuffer, setClassifierParams, destroyClassifierSystem,
  CLASS_NONE, CLASS_BULK, CLASS_SURFACE, CLASS_SPRAY, CLASS_FOAM, CLASS_BUBBLE,
} from './ParticleClassifier.js';

// Re-export rope↔particle interaction APIs
export {
  createRopeInteractionSystem, registerRopeForInteraction, unregisterRopeInteraction,
  stepRopeInteraction, getRopeInteractionState, destroyRopeInteractionSystem,
} from './RopeParticleInteraction.js';
export {
  ROPE_INTERACTION_MATERIALS, getRopeInteractionMaterial, createRopeNodeState,
  getSubstanceInteraction, INTERACTION_HEAT, INTERACTION_MOISTURE, INTERACTION_COOL, INTERACTION_CORRODE,
} from './RopeMaterial.js';

function directConfig(config = {}) {
  return {
    G: config.G ?? config.coupling,
    softening: config.softening,
    maxAccel: config.maxAccel ?? config.maxAcceleration,
    defaultMass: config.defaultMass ?? config.defaultSource,
    useParticleMass: config.useParticleMass,
    damping: config.damping,
  };
}

/** Select exactly one long-range force backend without changing the legacy default. */
export function configureParticleLongRange(world, config = {}) {
  if (!world?.device) throw new TypeError('configureParticleLongRange requires a particle world with a GPUDevice.');
  const backend = String(config.backend ?? 'direct').toLowerCase();
  if (!['none', 'direct', 'fmm', 'pme', 'esp'].includes(backend)) {
    throw new RangeError("Long-range backend must be 'none', 'direct', 'fmm', 'pme', or 'esp'.");
  }

  if (world.longRangeBackend === backend) {
    const fmmRecreationRequired = backend === 'fmm'
      && config.depth != null
      && Number(config.depth) !== world.fmmSystem?.config?.depth;
    const meshRecreationRequired = (backend === 'pme' || backend === 'esp')
      && (Number(config.gridSize ?? world.particleMeshEwaldSystem?.config?.gridSize)
          !== world.particleMeshEwaldSystem?.config?.gridSize
        || Number(config.prolateBandwidth ?? world.particleMeshEwaldSystem?.config?.prolateBandwidth)
          !== world.particleMeshEwaldSystem?.config?.prolateBandwidth
        || Number(config.windowRadius ?? world.particleMeshEwaldSystem?.config?.windowRadius)
          !== world.particleMeshEwaldSystem?.config?.windowRadius
        || (backend === 'esp'
          && (Number(config.realCutoff ?? world.particleMeshEwaldSystem?.config?.realCutoff)
              !== world.particleMeshEwaldSystem?.config?.realCutoff
            || Number(config.domainHalfExtent ?? world.particleMeshEwaldSystem?.config?.domainHalfExtent)
              !== world.particleMeshEwaldSystem?.config?.domainHalfExtent)));
    if (!fmmRecreationRequired && !meshRecreationRequired) {
      if (backend === 'direct') setNBodyParams(world.nBodySystem, directConfig(config));
      if (backend === 'fmm') setFmmParams(world.fmmSystem, config);
      if (backend === 'pme' || backend === 'esp') setParticleMeshEwaldParams(world.particleMeshEwaldSystem, config);
      return getParticleLongRangeState(world);
    }
  }

  if (world.nBodySystem) destroyNBodySystem(world.nBodySystem);
  if (world.fmmSystem) destroyFmmSystem(world.fmmSystem);
  if (world.particleMeshEwaldSystem) destroyParticleMeshEwaldSystem(world.particleMeshEwaldSystem);
  world.nBodySystem = null;
  world.fmmSystem = null;
  world.particleMeshEwaldSystem = null;
  world.longRangeBackend = null;

  if (backend === 'none') return getParticleLongRangeState(world);
  const { device, maxParticles } = world;
  if (backend === 'direct') {
    world.nBodySystem = createNBodySystem(device, maxParticles);
    initNBodyBindGroups(
      world.nBodySystem,
      device,
      world.positionBuffer,
      world.velocityBuffer,
      world.metaBuffer,
      world.thermalBuffer,
    );
    setNBodyParams(world.nBodySystem, directConfig(config));
  } else if (backend === 'fmm') {
    world.fmmSystem = createFmmSystem(device, maxParticles, config);
    initFmmBindGroups(
      world.fmmSystem,
      device,
      world.positionBuffer,
      world.velocityBuffer,
      world.metaBuffer,
      world.thermalBuffer,
    );
  } else {
    world.particleMeshEwaldSystem = createParticleMeshEwaldSystem(device, maxParticles, { ...config, backend });
    initParticleMeshEwaldBindGroups(
      world.particleMeshEwaldSystem,
      device,
      world.positionBuffer,
      world.velocityBuffer,
      world.metaBuffer,
      world.thermalBuffer,
    );
  }
  world.longRangeBackend = backend;
  console.info(`[ParticleSimWorld] Long-range backend initialized: ${backend}`);
  return getParticleLongRangeState(world);
}

export function getParticleLongRangeState(world) {
  const system = world?.fmmSystem || world?.particleMeshEwaldSystem || world?.nBodySystem || null;
  return Object.freeze({
    backend: world?.longRangeBackend || null,
    boundary: world?.longRangeBackend === 'fmm' || world?.longRangeBackend === 'direct' ? 'open'
      : (world?.longRangeBackend ? 'periodic' : null),
    config: system?.config || (system ? Object.freeze({
      coupling: system.G,
      softening: system.softening,
      maxAcceleration: system.maxAccel,
      defaultSource: system.defaultMass,
      useParticleMass: system.useParticleMass,
      damping: system.damping,
    }) : null),
    memory: system?.memory || null,
    lastExecution: system?.lastExecution || null,
  });
}

/**
 * Lazily enable a particle system on an existing world if not already initialized.
 * Call from editor/runtime when an emitter's physics profile requires a system
 * that wasn't enabled at init time.
 * 
 * @param {Object} world - Particle sim world
 * @param {string} systemName - Includes 'longRange' plus the legacy GAP 33-38 names.
 * @param {Object} [config] - Optional config for the system
 * @returns {boolean} True if system was newly initialized
 */
export function ensureSystemEnabled(world, systemName, config) {
  if (!world || !world.device) return false;
  const device = world.device;
  const maxParticles = world.maxParticles || 0;

  switch (systemName) {
    case 'longRange':
      configureParticleLongRange(world, config || {});
      return true;

    case 'elementTable':
      if (world.elementTable) return false;
      world.elementTable = createElementTable(device, maxParticles);
      console.log('[ParticleSimWorld] Lazy-init: Element table');
      return true;

    case 'lennardJones':
      if (world.lennardJonesSystem) return false;
      if (!world.neighborGridSystem) return false;
      world.lennardJonesSystem = createLennardJonesSystem(device, maxParticles);
      initLJBindGroups(world.lennardJonesSystem, device, world.positionBuffer, world.velocityBuffer, getNeighborGridBuffers(world.neighborGridSystem), world.elementTable, world.thermalBuffer);
      console.log('[ParticleSimWorld] Lazy-init: Lennard-Jones');
      return true;

    case 'electromagnetic':
      if (world.electromagneticSystem) return false;
      if (!world.neighborGridSystem) return false;
      world.electromagneticSystem = createElectromagneticSystem(device, maxParticles);
      const chargeBuffer = world.elementTable?.chargeBuffer || null;
      initEMBindGroups(world.electromagneticSystem, device, world.positionBuffer, world.velocityBuffer, getNeighborGridBuffers(world.neighborGridSystem), chargeBuffer, world.thermalBuffer);
      console.log('[ParticleSimWorld] Lazy-init: Electromagnetic');
      return true;

    case 'sph':
      if (world.sphSystem) return false;
      if (!world.neighborGridSystem) return false;
      world.sphSystem = createSPHSystem(device, maxParticles);
      initSPHBindGroups(world.sphSystem, device, world.positionBuffer, world.velocityBuffer, getNeighborGridBuffers(world.neighborGridSystem), world.thermalBuffer);
      if (config) setSPHParams(world.sphSystem, config);
      // Also create classifier — it needs the SPH density buffer
      if (!world.classifierSystem && world.thermalBuffer) {
        world.classifierSystem = createClassifierSystem(device, maxParticles);
        initClassifierBindGroups(world.classifierSystem, device, world.positionBuffer, world.velocityBuffer, world.thermalBuffer, getSPHDensityBuffer(world.sphSystem));
      }
      console.log('[ParticleSimWorld] Lazy-init: SPH fluid dynamics + classifier');
      return true;

    case 'nBody':
      if (world.nBodySystem) return false;
      world.nBodySystem = createNBodySystem(device, maxParticles);
      initNBodyBindGroups(world.nBodySystem, device, world.positionBuffer, world.velocityBuffer, world.metaBuffer, world.thermalBuffer);
      if (config) setNBodyParams(world.nBodySystem, config);
      world.longRangeBackend = 'direct';
      console.log('[ParticleSimWorld] Lazy-init: N-body gravity');
      return true;

    case 'chemistry':
      if (world.chemistrySystem) return false;
      if (!world.neighborGridSystem || !world.elementTable || !world.thermalBuffer) return false;
      world.chemistrySystem = createChemistrySystem(device, maxParticles);
      initChemistryBindGroups(world.chemistrySystem, device, world.positionBuffer, world.velocityBuffer, getNeighborGridBuffers(world.neighborGridSystem), world.elementTable, world.thermalBuffer);
      console.log('[ParticleSimWorld] Lazy-init: Chemistry');
      return true;

    default:
      console.warn(`[ParticleSimWorld] Unknown system: ${systemName}`);
      return false;
  }
}

// ============================================================================
// WARM-UP / PRE-SIMULATION (GAP 12)
// ============================================================================

/**
 * Pre-simulate a particle world for N seconds before the first visible frame.
 * Runs stepParticleSimWorld repeatedly with fixed timestep so effects look
 * "established" immediately (e.g. fire already burning, smoke already rising).
 * 
 * @param {Object} world - Particle world
 * @param {number} warmUpSeconds - Total time to pre-simulate (default: 2.0)
 * @param {Object} options
 * @param {number} options.fixedDt - Fixed timestep per sub-step (default: 1/30)
 * @param {number} options.maxSteps - Safety cap on iterations (default: 300)
 * @param {Function} options.onStep - Optional callback per step: (stepIndex, totalSteps) => void
 */
export function warmUpParticleWorld(world, warmUpSeconds = 2.0, options = {}) {
  if (!world || !world.device || !world.pipeline) return;
  
  const fixedDt = options.fixedDt || (1 / 30);
  const maxSteps = options.maxSteps || 300;
  const onStep = typeof options.onStep === 'function' ? options.onStep : null;
  
  const totalSteps = Math.min(Math.ceil(warmUpSeconds / fixedDt), maxSteps);
  
  for (let i = 0; i < totalSteps; i++) {
    stepParticleSimWorld(world, fixedDt, { warmUp: true });
    if (onStep) onStep(i, totalSteps);
  }
}

// ============================================================================
// UNIFIED ROPE/CONSTRAINT PARTICLE SYSTEM (Phase 1)
// ============================================================================

/**
 * Reserve a range of particles for a specific backend
 * @param {Object} particleWorld - Particle world instance
 * @param {number} count - Number of particles to reserve
 * @param {string} backend - Backend type: 'free', 'gpu', 'physx', 'pbd'
 * @returns {Object|null} { particleOffset, particleCount } or null if failed
 */
export function reserveParticles(particleWorld, count, backend = 'free') {
  if (!particleWorld || count <= 0) return null;

  const tryAssertNoOverlap = (start, len) => {
    const end = start + len - 1;
    if (!Array.isArray(particleWorld.ropeChains) || particleWorld.ropeChains.length === 0) return true;
    for (const r of particleWorld.ropeChains) {
      if (!r) continue;
      const rs = r.particleStart;
      const rc = r.particleCount;
      if (!Number.isFinite(rs) || !Number.isFinite(rc) || rc <= 0) continue;
      const re = rs + rc - 1;
      const overlaps = start <= re && rs <= end;
      if (overlaps) {
        try {
          console.error(`[ParticleSimWorld] Particle reservation overlap: request=[${start}-${end}] overlaps rope entity=${r.entityId} backend=${r.backend} range=[${rs}-${re}]`);
        } catch (_) {}
        return false;
      }
    }
    return true;
  };

  const getOrInitAllocator = () => {
    const hwm = particleWorld._reservedHighWaterMark;
    if (!Number.isFinite(hwm) || hwm <= 0 || hwm > particleWorld.maxParticles) {
      particleWorld._reservedHighWaterMark = particleWorld.maxParticles;
    }
    if (!Array.isArray(particleWorld._freeRanges)) {
      particleWorld._freeRanges = [];
    }
  };
  getOrInitAllocator();

  const allocateFromFreeList = (need) => {
    const ranges = particleWorld._freeRanges;
    for (let i = 0; i < ranges.length; i++) {
      const fr = ranges[i];
      if (!fr || fr.count < need) continue;
      const start = fr.start;
      if (!Number.isFinite(start) || start < 0) continue;
      if (!tryAssertNoOverlap(start, need)) {
        return null;
      }

      if (fr.count === need) {
        ranges.splice(i, 1);
      } else {
        fr.start += need;
        fr.count -= need;
      }
      return start;
    }
    return null;
  };

  let offset = allocateFromFreeList(count);
  if (offset == null) {
    const hi = Number.isFinite(particleWorld._reservedHighWaterMark) ? particleWorld._reservedHighWaterMark : particleWorld.maxParticles;
    offset = hi - count;
    if (!Number.isFinite(offset)) offset = -1;

    if (offset < 0) {
      console.warn(`[ParticleSimWorld] Cannot reserve ${count} particles (highWater: ${hi}, max: ${particleWorld.maxParticles})`);
      return null;
    }

    if (!tryAssertNoOverlap(offset, count)) {
      return null;
    }

    particleWorld._reservedHighWaterMark = offset;
  }
  
  // Update counter for this backend
  switch (backend) {
    case 'free':
      particleWorld.freeParticleCount += count;
      break;
    case 'gpu':
      particleWorld.gpuConstrainedCount += count;
      break;
    case 'physx':
      particleWorld.physxCount += count;
      break;
    case 'pbd':
      particleWorld.pbdCount += count;
      break;
    default:
      console.warn(`[ParticleSimWorld] Unknown backend: ${backend}`);
      return null;
  }
  
  console.log(`[ParticleSimWorld] Reserved ${count} particles for ${backend} backend at offset ${offset}`);
  return { particleOffset: offset, particleCount: count };
}

/**
 * Release reserved particles (e.g., when rope is destroyed)
 * @param {Object} particleWorld - Particle world instance
 * @param {number} count - Number of particles to release
 * @param {string} backend - Backend type
 */
export function releaseParticles(particleWorld, count, backend) {
  if (!particleWorld) return;

  let start = null;
  let realCount = count;
  let realBackend = backend;

  if (typeof backend === 'number' || backend == null) {
    start = count;
    realCount = backend;
    realBackend = arguments.length >= 4 ? arguments[3] : null;
  }

  if (!Number.isFinite(realCount) || realCount <= 0) return;

  const normalizeAllocator = () => {
    const hwm = particleWorld._reservedHighWaterMark;
    if (!Number.isFinite(hwm) || hwm <= 0 || hwm > particleWorld.maxParticles) {
      particleWorld._reservedHighWaterMark = particleWorld.maxParticles;
    }
    if (!Array.isArray(particleWorld._freeRanges)) {
      particleWorld._freeRanges = [];
    }
  };
  const insertAndCoalesce = (start, len) => {
    if (!Number.isFinite(start) || start < 0) return;
    if (!Number.isFinite(len) || len <= 0) return;
    normalizeAllocator();

    const ranges = particleWorld._freeRanges;
    const end = start + len;

    if (start === particleWorld._reservedHighWaterMark) {
      particleWorld._reservedHighWaterMark = end;

      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (!r) continue;
          if (r.start === particleWorld._reservedHighWaterMark) {
            particleWorld._reservedHighWaterMark = r.start + r.count;
            ranges.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      return;
    }

    // Insert sorted by start.
    let idx = 0;
    while (idx < ranges.length && ranges[idx] && ranges[idx].start < start) idx++;
    ranges.splice(idx, 0, { start, count: len });

    // Coalesce neighbors.
    for (let i = 0; i < ranges.length - 1; ) {
      const a = ranges[i];
      const b = ranges[i + 1];
      if (!a || !b) { i++; continue; }
      const aEnd = a.start + a.count;
      if (aEnd === b.start) {
        a.count += b.count;
        ranges.splice(i + 1, 1);
        continue;
      }
      i++;
    }
  };
  
  switch (realBackend) {
    case 'free':
      particleWorld.freeParticleCount = Math.max(0, particleWorld.freeParticleCount - realCount);
      break;
    case 'gpu':
      particleWorld.gpuConstrainedCount = Math.max(0, particleWorld.gpuConstrainedCount - realCount);
      break;
    case 'physx':
      particleWorld.physxCount = Math.max(0, particleWorld.physxCount - realCount);
      break;
    case 'pbd':
      particleWorld.pbdCount = Math.max(0, particleWorld.pbdCount - realCount);
      break;
  }

  if (Number.isFinite(start) && start >= 0) {
    try {
      normalizeAllocator();
      const ranges = particleWorld._freeRanges;
      const freeStart = start;
      const freeEnd = start + realCount;
      for (const r of ranges) {
        if (!r) continue;
        const rStart = r.start;
        const rEnd = r.start + r.count;
        const overlaps = freeStart < rEnd && rStart < freeEnd;
        if (overlaps) {
          console.error(`[ParticleSimWorld] Double free / overlapping free range: free=[${freeStart}-${freeEnd}) overlaps existing free=[${rStart}-${rEnd})`);
          return;
        }
      }
    } catch (_) {}

    insertAndCoalesce(start, realCount);
  }
}

/**
 * Upload particle positions to GPU buffer
 * Used by PhysX and PBD backends to sync CPU simulation results to GPU
 * @param {Object} particleWorld - Particle world instance
 * @param {number} particleOffset - Start index in position buffer
 * @param {Array<Array<number>>} positions - Array of [x, y, z] positions
 */
// Cached Float32Array for uploadParticles (avoids per-call TypedArray allocation)
let _uploadBuf = null;
let _uploadBufLen = 0;

export function uploadParticles(particleWorld, particleOffset, positions) {
  if (!particleWorld || !particleWorld.device || !particleWorld.positionBuffer) {
    return;
  }
  
  if (!positions || positions.length === 0) return;
  
  const device = particleWorld.device;
  
  // Pack positions into vec4 format: [x, y, z, age]
  const needed = positions.length * 4;
  if (!_uploadBuf || _uploadBufLen < needed) {
    _uploadBufLen = Math.max(needed, 256);
    _uploadBuf = new Float32Array(_uploadBufLen);
  }
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const off = i * 4;
    _uploadBuf[off] = pos[0];
    _uploadBuf[off + 1] = pos[1];
    _uploadBuf[off + 2] = pos[2];
    _uploadBuf[off + 3] = 0;
  }
  
  const byteOffset = particleOffset * PARTICLE_STRIDE_BYTES;
  updateBuffer(device, particleWorld.positionBuffer, _uploadBuf.subarray(0, needed), byteOffset);
}

/**
 * Register a rope chain in the particle system
 * @param {Object} particleWorld - Particle world instance
 * @param {Object} ropeMetadata - Rope metadata object
 */
export function registerRopeChain(particleWorld, ropeMetadata) {
  if (!particleWorld || !ropeMetadata) return;
  
  // Ensure rope has an owner ID for the ownerBuffer (billboard shadow exclusion)
  if (!ropeMetadata.ropeId || ropeMetadata.ropeId === 0) {
    if (Array.isArray(particleWorld._freeOwnerIds) && particleWorld._freeOwnerIds.length > 0) {
      ropeMetadata.ropeId = (particleWorld._freeOwnerIds.pop() | 0) >>> 0;
    }
    if (!ropeMetadata.ropeId) {
      ropeMetadata.ropeId = (particleWorld._nextOwnerId | 0) >>> 0;
      const next = ((ropeMetadata.ropeId + 1) | 0) >>> 0;
      particleWorld._nextOwnerId = (next === 0 || next > OWNER_LOCAL_MASK) ? 1 : next;
    }
  }

  // Write ownership data so billboard shadow shader skips these particles
  if (particleWorld.ownerBuffer && Number.isFinite(ropeMetadata.particleStart) && ropeMetadata.particleCount > 0) {
    const owners = new Uint32Array(ropeMetadata.particleCount);
    for (let i = 0; i < ropeMetadata.particleCount; i++) {
      owners[i] = (ropeMetadata.ropeId << OWNER_ID_SHIFT) | (i & OWNER_LOCAL_MASK);
    }
    updateBuffer(particleWorld.device, particleWorld.ownerBuffer, owners, ropeMetadata.particleStart * 4);
  }

  particleWorld.ropeChains.push(ropeMetadata);
  if (ropeMetadata.entityId != null) {
    particleWorld.ropesByEntity.set(ropeMetadata.entityId, ropeMetadata);
  }
  
  console.log(`[ParticleSimWorld] Registered chain: entity=${ropeMetadata.entityId}, backend=${ropeMetadata.backend}, ropeId=${ropeMetadata.ropeId}, particles=[${ropeMetadata.particleStart}-${ropeMetadata.particleStart + ropeMetadata.particleCount - 1}]`);
}

/**
 * Unregister a rope chain from the particle system
 * @param {Object} particleWorld - Particle world instance
 * @param {number} entityId - Entity ID of the rope to remove
 */
export function unregisterRopeChain(particleWorld, entityId) {
  if (!particleWorld) return;
  
  const ropeIndex = particleWorld.ropeChains.findIndex(r => r.entityId === entityId);
  if (ropeIndex >= 0) {
    const rope = particleWorld.ropeChains[ropeIndex];

    if (particleWorld.ownerBuffer && Number.isFinite(rope.particleStart) && Number.isFinite(rope.particleCount) && rope.particleCount > 0) {
      updateBuffer(particleWorld.device, particleWorld.ownerBuffer, new Uint32Array(rope.particleCount | 0), (rope.particleStart | 0) * 4);
    }
    
    // Release particle reservation
    releaseParticles(particleWorld, rope.particleStart, rope.particleCount, rope.backend);

    if (Number.isFinite(rope.ropeId) && rope.ropeId > 0 && rope.ropeId <= OWNER_LOCAL_MASK) {
      if (!Array.isArray(particleWorld._freeOwnerIds)) {
        particleWorld._freeOwnerIds = [];
      }
      particleWorld._freeOwnerIds.push(rope.ropeId | 0);
    }
    
    // Remove from registry
    particleWorld.ropeChains.splice(ropeIndex, 1);
    particleWorld.ropesByEntity.delete(entityId);
    
    console.log(`[ParticleSimWorld] Unregistered chain: entity=${entityId}`);
  }
}

/**
 * Get total particle count across all backends
 * @param {Object} particleWorld - Particle world instance
 * @returns {number} Total reserved particle count
 */
export function getTotalReservedParticles(particleWorld) {
  if (!particleWorld) return 0;
  return particleWorld.freeParticleCount 
       + particleWorld.gpuConstrainedCount 
       + particleWorld.physxCount 
       + particleWorld.pbdCount;
}
